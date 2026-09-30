import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { getSupabaseClient, isSupabaseConfigured } from '../config/supabase.js';

export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. No token provided.',
      });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Invalid authentication token format.',
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, config.jwtSecret);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          error: 'Session expired. Please log in again.',
        });
      }
      return res.status(401).json({
        success: false,
        error: 'Invalid or malformed authentication token.',
      });
    }

    if (!decoded.id) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token payload.',
      });
    }

    // If Supabase is configured, verify user exists in DB and get latest role
    if (isSupabaseConfigured()) {
      const supabase = getSupabaseClient();
      const { data: user, error } = await supabase
        .from('users')
        .select('id, name, email, role, created_at')
        .eq('id', decoded.id)
        .single();

      if (error || !user) {
        return res.status(401).json({
          success: false,
          error: 'User account no longer exists or is invalid.',
        });
      }

      req.user = user;
    } else {
      // Fallback to token payload if DB is not yet connected
      req.user = {
        id: decoded.id,
        name: decoded.name,
        email: decoded.email,
        role: decoded.role,
      };
    }

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Internal server error during authentication.',
    });
  }
};
