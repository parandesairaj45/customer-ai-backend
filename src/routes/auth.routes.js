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

export default router;
