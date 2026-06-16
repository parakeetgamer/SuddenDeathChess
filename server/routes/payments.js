const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('./auth');

const router = express.Router();

// Stripe is initialized lazily so the server still boots if keys aren't set yet.
let stripe = null;
try {
  if (process.env.STRIPE_SECRET_KEY) stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
} catch (e) {
  console.warn('[STRIPE] SDK unavailable:', e.message);
}

const PRICE_MONTHLY  = process.env.STRIPE_PRICE_MONTHLY  || '';
const PRICE_ANNUAL   = process.env.STRIPE_PRICE_ANNUAL   || '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET  || '';

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token.' });
  try { req.user = jwt.verify(header.replace('Bearer ', ''), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token.' }); }
}

// Create a hosted Stripe Checkout session and return its URL for redirect.
router.post('/create-checkout-session', auth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments are not configured yet.' });
  const plan = (req.body && req.body.plan === 'annual') ? 'annual' : 'monthly';
  const price = plan === 'annual' ? PRICE_ANNUAL : PRICE_MONTHLY;
  if (!price) return res.status(503).json({ error: 'This plan is not configured yet.' });
  const base = process.env.APP_URL || req.headers.origin || ('https://' + req.get('host'));
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      client_reference_id: String(req.user.id),
      metadata: { userId: String(req.user.id) },
      subscription_data: { metadata: { userId: String(req.user.id) } },
      allow_promotion_codes: true,
      success_url: base + '/?checkout=success',
      cancel_url: base + '/?checkout=cancel'
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('[STRIPE] create session failed:', e.message);
    res.status(500).json({ error: 'Could not start checkout.' });
  }
});

// Stripe webhook -- mounted in index.js with express.raw() BEFORE express.json().
async function webhook(req, res) {
  if (!stripe || !WEBHOOK_SECRET) return res.status(503).send('not configured');
  const sig = req.headers['stripe-signature'];
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET); }
  catch (e) { console.error('[STRIPE] bad signature:', e.message); return res.status(400).send('Webhook Error: ' + e.message); }

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object;
      const userId = s.client_reference_id || (s.metadata && s.metadata.userId);
      if (userId) db.run('UPDATE users SET is_premium=1, no_ads=1, stripe_customer_id=? WHERE id=?', [s.customer || null, userId]);
      console.log('[STRIPE] premium activated for user', userId);
    } else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      db.run('UPDATE users SET is_premium=0 WHERE stripe_customer_id=?', [sub.customer]);
      console.log('[STRIPE] subscription ended for customer', sub.customer);
    } else if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object;
      const active = sub.status === 'active' || sub.status === 'trialing';
      db.run('UPDATE users SET is_premium=?, no_ads=CASE WHEN ?=1 THEN 1 ELSE no_ads END WHERE stripe_customer_id=?',
        [active ? 1 : 0, active ? 1 : 0, sub.customer]);
    }
  } catch (e) { console.error('[STRIPE] webhook handler error:', e.message); }

  res.json({ received: true });
}

module.exports = { router, webhook };
