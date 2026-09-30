import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { getSupabaseClient, isSupabaseConfigured } from '../config/supabase.js';
import { registerSchema, loginSchema } from '../validators/auth.validator.js';

/**
 * Register a new user account.
 * IMPORTANT: Normal public registration always creates a CUSTOMER account.
 * Role is never accepted from the frontend.
 */
export const register = async (req, res, next) => {
  try {
    const validatedData = registerSchema.parse(req.body);
    const { name, email, password } = validatedData;
    const normalizedEmail = email.toLowerCase().trim();

    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Database is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      });
    }

    const supabase = getSupabaseClient();

    // Check if user with this email already exists
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (checkError) {
      console.error('[Auth Error] Error checking existing user:', checkError);
      return res.status(500).json({
        success: false,
        error: 'Database error occurred while checking account.',
      });
    }

    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'An account with this email address already exists.',
      });
    }

    // Hash the password with bcrypt (salt rounds = 10)
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Strictly enforce role as 'customer' for all public registrations
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert([
        {
          name: name.trim(),
          email: normalizedEmail,
          password_hash,
          role: 'customer',
        },
      ])
      .select('id, name, email, role, created_at')
      .single();

    if (insertError || !newUser) {
      console.error('[Auth Error] Error creating user record:', insertError);
      return res.status(500).json({
        success: false,
        error: 'Failed to create user account.',
      });
    }

    // Generate JWT
    const token = jwt.sign(
      {
        id: newUser.id,
        email: newUser.email,
        role: newUser.role,
        name: newUser.name,
      },
      config.jwtSecret,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      success: true,
      message: 'Account successfully registered.',
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        created_at: newUser.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Login user and issue JWT token.
 * User role is retrieved strictly from the database.
 */
export const login = async (req, res, next) => {
  try {
    const validatedData = loginSchema.parse(req.body);
    const { email, password } = validatedData;
    const normalizedEmail = email.toLowerCase().trim();

    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Database is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      });
    }

    const supabase = getSupabaseClient();

    // Fetch user including password_hash
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, email, password_hash, role, created_at')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (error) {
      console.error('[Auth Error] Login lookup failed:', error);
      return res.status(500).json({
        success: false,
        error: 'Database error occurred during login.',
      });
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
    }

    // Verify bcrypt password hash
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
    }

    // Generate JWT with database-verified role
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
      config.jwtSecret,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      success: true,
      message: 'Authentication successful.',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        created_at: user.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Return current authenticated user profile.
 */
export const getMe = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.',
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        created_at: req.user.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
};
