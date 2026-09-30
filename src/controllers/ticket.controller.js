import { getSupabaseClient, isSupabaseConfigured } from '../config/supabase.js';
import { analyzeCustomerIssue } from '../services/ai.service.js';
import { createTicketSchema, createMessageSchema } from '../validators/ticket.validator.js';

/**
 * Customer creates a new support ticket.
 * Runs real Gemini AI analysis with sector context and saves ticket to Supabase.
 */
export const createTicket = async (req, res, next) => {
  try {
    const validatedData = createTicketSchema.parse(req.body);
    const { sector, issue_description } = validatedData;

    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Database is not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      });
    }

    // Step 1: Perform real Gemini AI analysis on the actual issue
    const aiAnalysis = await analyzeCustomerIssue(sector, issue_description);

    // Step 2: Insert into Supabase tickets table
    const supabase = getSupabaseClient();
    const { data: ticket, error: insertError } = await supabase
      .from('tickets')
      .insert([
        {
          customer_id: req.user.id,
          sector,
          issue_description,
          ai_summary: aiAnalysis.summary,
          ai_category: aiAnalysis.category,
          ai_priority: aiAnalysis.priority,
          ai_sentiment: aiAnalysis.sentiment,
          ai_recommended_action: aiAnalysis.recommendedAction,
          resolution_notes: aiAnalysis.customerResponse,
          status: 'open',
        },
      ])
      .select('*')
      .single();

    if (insertError || !ticket) {
      console.error('[Ticket Error] Failed to insert ticket:', insertError);
      return res.status(500).json({
        success: false,
        error: 'Failed to create ticket in database.',
      });
    }

    const enrichedTicket = {
      ...ticket,
      ai_customer_response: aiAnalysis.customerResponse || ticket.resolution_notes,
    };

    return res.status(201).json({
      success: true,
      message: 'Customer experience feedback created and analyzed successfully.',
      ticket: enrichedTicket,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieve all tickets belonging to the authenticated customer.
 */
export const getMyTickets = async (req, res, next) => {
  try {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Database is not configured.',
      });
    }

    const supabase = getSupabaseClient();
    const { data: tickets, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('customer_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Ticket Error] getMyTickets failed:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch customer tickets.',
      });
    }

    const enrichedTickets = (tickets || []).map((t) => ({
      ...t,
      ai_customer_response: t.resolution_notes,
    }));

    return res.status(200).json({
      success: true,
      tickets: enrichedTickets,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get ticket details and conversation messages.
 * Enforces strict authorization: customer can ONLY access their own ticket.
 */
export const getTicketById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Database is not configured.',
      });
    }

    const supabase = getSupabaseClient();

    // Fetch the ticket
    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (ticketError) {
      console.error('[Ticket Error] getTicketById lookup failed:', ticketError);
      return res.status(500).json({
        success: false,
        error: 'Database error retrieving ticket.',
      });
    }

    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: 'Ticket not found.',
      });
    }

    // Security check: If customer, must own this ticket
    if (req.user.role === 'customer' && ticket.customer_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: You do not have permission to view this ticket.',
      });
    }

    // Fetch conversation messages
    let messages = [];
    const { data: messagesData, error: messagesError } = await supabase
      .from('messages')
      .select('id, ticket_id, sender_id, message, created_at, users!sender_id(id, name, role)')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true });

    if (messagesError) {
      // Fallback query if relation syntax has constraint alias differences
      const { data: rawMessages } = await supabase
        .from('messages')
        .select('*')
        .eq('ticket_id', id)
        .order('created_at', { ascending: true });

      if (rawMessages && rawMessages.length > 0) {
        const senderIds = [...new Set(rawMessages.map((m) => m.sender_id))];
        const { data: senders } = await supabase
          .from('users')
          .select('id, name, role')
          .in('id', senderIds);

        const senderMap = new Map((senders || []).map((s) => [s.id, s]));
        messages = rawMessages.map((m) => ({
          ...m,
          sender: senderMap.get(m.sender_id) || { id: m.sender_id, name: 'Unknown', role: 'customer' },
        }));
      }
    } else {
      messages = (messagesData || []).map((m) => ({
        id: m.id,
        ticket_id: m.ticket_id,
        sender_id: m.sender_id,
        message: m.message,
        created_at: m.created_at,
        sender: m.users || { id: m.sender_id, name: 'User', role: 'customer' },
      }));
    }

    const enrichedTicket = {
      ...ticket,
      ai_customer_response: ticket.resolution_notes,
    };

    return res.status(200).json({
      success: true,
      ticket: enrichedTicket,
      messages,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Add a message to the ticket conversation.
 */
export const addCustomerMessage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const validatedData = createMessageSchema.parse(req.body);
    const { message } = validatedData;

    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Database is not configured.',
      });
    }

    const supabase = getSupabaseClient();

    // Verify ticket existence and ownership
    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .select('id, customer_id, status')
      .eq('id', id)
      .maybeSingle();

    if (ticketError || !ticket) {
      return res.status(404).json({
        success: false,
        error: 'Ticket not found.',
      });
    }

    if (req.user.role === 'customer' && ticket.customer_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: You cannot message on another customer\'s ticket.',
      });
    }

    // Insert message into messages table
    const { data: newMessage, error: msgError } = await supabase
      .from('messages')
      .insert([
        {
          ticket_id: id,
          sender_id: req.user.id,
          message: message.trim(),
        },
      ])
      .select('*')
      .single();

    if (msgError || !newMessage) {
      console.error('[Ticket Message Error] Insert failed:', msgError);
      return res.status(500).json({
        success: false,
        error: 'Failed to send message.',
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Message sent successfully.',
      data: {
        ...newMessage,
        sender: {
          id: req.user.id,
          name: req.user.name,
          role: req.user.role,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};
