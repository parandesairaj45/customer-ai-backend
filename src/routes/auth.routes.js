import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { getSupabaseClient, isSupabaseConfigured } from '../config/supabase.js';
import { authenticateToken } from '../middleware/auth.middleware.js';
import { registerSchema, loginSchema } from '../validators/auth.validator.js';

const router = Router();

const createToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    config.jwtSecret,
    { expiresIn: '7d' }
  );
};

router.post('/register', async (req, res, next) => {
  try {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Supabase is not configured.',
      });
    }

    const parsed = registerSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid registration data.',
        details: parsed.error.flatten(),
      });
    }

    const { name, email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase().trim();
    const supabase = getSupabaseClient();

    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'An account with this email already exists.',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const role = (req.body.role === 'support' || req.body.role === 'support_agent') ? 'support_agent' : 'customer';

    const { data: user, error } = await supabase
      .from('users')
      .insert({
        name,
        email: normalizedEmail,
        password_hash: passwordHash,
        role,
      })
      .select('id, name, email, role, created_at')
      .single();

    if (error) {
      return next(error);
    }

    const token = createToken(user);

    return res.status(201).json({
      success: true,
      message: 'Customer account created successfully.',
      token,
      user,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Supabase is not configured.',
      });
    }

    const parsed = loginSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid login data.',
        details: parsed.error.flatten(),
      });
    }

    const { email, password } = parsed.data;
    const normalizedEmail = email.toLowerCase().trim();
    const supabase = getSupabaseClient();

    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, role, password_hash, created_at')
      .eq('email', normalizedEmail)
      .single();

    if (error || !user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      created_at: user.created_at,
    };

    const token = createToken(safeUser);

    return res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: safeUser,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/me', authenticateToken, (req, res) => {
  return res.json({
    success: true,
    user: req.user,
  });
});

router.post('/forgot-password', async (req, res, next) => {
  try {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Database is not configured.',
      });
    }

    const { email } = req.body;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid email address.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const supabase = getSupabaseClient();

    // Check if user exists in custom users table
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('id, name, email')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (findError) {
      return next(findError);
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'No account found with this email address.',
      });
    }

    // Ensure user exists in Supabase Auth service for email delivery
    try {
      const { data: usersData } = await supabase.auth.admin.listUsers();
      const authUser = usersData?.users?.find((u) => u.email === normalizedEmail);
      if (!authUser) {
        await supabase.auth.admin.createUser({
          email: normalizedEmail,
          email_confirm: true,
        });
      }
    } catch (authErr) {
      console.warn('[Supabase Auth Sync Warning]:', authErr?.message || authErr);
    }

    const frontendUrl = config.frontendUrl || 'https://customer-ai-frontend.vercel.app';
    const redirectUrl = `${frontendUrl.replace(/\/+$/, '')}/reset-password`;

    // Trigger Supabase password-reset email
    let supabaseEmailSent = false;
    let linkData = null;

    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: redirectUrl,
      });
      if (!resetErr) {
        supabaseEmailSent = true;
      } else {
        console.warn('[Supabase resetPasswordForEmail notice]:', resetErr.message);
      }
    } catch (e) {
      console.warn('[Supabase reset exception]:', e?.message);
    }

    // Also generate recovery link with Supabase admin
    try {
      const res = await supabase.auth.admin.generateLink({
        type: 'recovery',
        email: normalizedEmail,
        options: { redirectTo: redirectUrl },
      });
      linkData = res.data;
    } catch (e) {
      console.warn('[Supabase generateLink notice]:', e?.message);
    }

    // Signed fallback token valid for 1 hour
    const resetToken = jwt.sign(
      { email: normalizedEmail, purpose: 'reset-password' },
      config.jwtSecret,
      { expiresIn: '1h' }
    );

    return res.json({
      success: true,
      message: 'Password reset link sent! Please check your email inbox and spam folder.',
      emailSent: supabaseEmailSent,
      resetToken,
      actionLink: linkData?.properties?.action_link || null,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Database is not configured.',
      });
    }

    const { email, password, token } = req.body;

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long.',
      });
    }

    let targetEmail = (email || '').toLowerCase().trim();

    // Verify token if provided
    if (token) {
      try {
        const decoded = jwt.verify(token, config.jwtSecret);
        if (decoded.email) {
          targetEmail = decoded.email.toLowerCase().trim();
        }
      } catch {
        // If not our JWT, check if it's a Supabase auth token
        const supabase = getSupabaseClient();
        try {
          const { data } = await supabase.auth.getUser(token);
          if (data?.user?.email) {
            targetEmail = data.user.email.toLowerCase().trim();
          }
        } catch {
          // Token verification failed
        }
      }
    }

    if (!targetEmail) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or expired password reset link. Please request a new one.',
      });
    }

    const supabase = getSupabaseClient();

    // Verify user exists in custom users table
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', targetEmail)
      .maybeSingle();

    if (userError || !user) {
      return res.status(404).json({
        success: false,
        error: 'User account not found.',
      });
    }

    // Hash the new password using bcrypt
    const passwordHash = await bcrypt.hash(password, 12);

    // Update custom users table in Supabase
    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash: passwordHash })
      .eq('email', targetEmail);

    if (updateError) {
      return next(updateError);
    }

    // Also update Supabase Auth user password
    try {
      const { data: usersData } = await supabase.auth.admin.listUsers();
      const authUser = usersData?.users?.find((u) => u.email === targetEmail);
      if (authUser?.id) {
        await supabase.auth.admin.updateUserById(authUser.id, { password });
      }
    } catch (authErr) {
      console.warn('[Supabase Auth password update notice]:', authErr?.message);
    }

    return res.json({
      success: true,
      message: 'Password reset successful! You can now log in with your new password.',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
