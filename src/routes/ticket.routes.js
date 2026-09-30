import { Router } from 'express';
import {
  createTicket,
  getMyTickets,
  getTicketById,
  addCustomerMessage,
} from '../controllers/ticket.controller.js';
import { authenticateToken } from '../middleware/auth.middleware.js';

import { analyzeCustomerIssue } from '../services/ai.service.js';

const router = Router();

// Public live AI analysis preview endpoint (for real-time live demo & evaluation)
router.post('/analyze-preview', async (req, res, next) => {
  try {
    const { sector = 'Other', issue_description } = req.body;
    if (!issue_description || typeof issue_description !== 'string') {
      return res.status(400).json({ success: false, error: 'issue_description is required' });
    }
    const analysis = await analyzeCustomerIssue(sector, issue_description);
    return res.json({ success: true, analysis });
  } catch (err) {
    next(err);
  }
});

// All ticket routes below require authentication
router.use(authenticateToken);

router.post('/', createTicket);
router.get('/my', getMyTickets);

// Support agent view all tickets
router.get('/all', async (req, res, next) => {
  try {
    const { getSupabaseClient } = await import('../config/supabase.js');
    const supabase = getSupabaseClient();
    const { data: tickets, error } = await supabase
      .from('tickets')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Ticket Error] getAllTickets failed:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch tickets' });
    }

    return res.json({ success: true, tickets: tickets || [] });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', getTicketById);
router.post('/:id/messages', addCustomerMessage);

// Support agent update status
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['open', 'in_progress', 'resolved'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status must be open, in_progress, or resolved' });
    }
    const { getSupabaseClient } = await import('../config/supabase.js');
    const supabase = getSupabaseClient();
    const { data: ticket, error } = await supabase
      .from('tickets')
      .update({ status })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      return res.status(500).json({ success: false, error: 'Failed to update ticket status' });
    }
    return res.json({ success: true, ticket });
  } catch (err) {
    next(err);
  }
});

export default router;
