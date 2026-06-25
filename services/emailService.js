const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

async function sendOrderNotificationToRestaurant({ restaurantEmail, restaurantName, orderNumber, theme, guestCount, deliveryTime, deliveryAddress, items, subtotal, platformFee, deliveryFeeAmount, restaurantPayout, taxAmount, taxRate }) {
  const itemList = (items || []).map(i => `• ${i.item_name} x${i.quantity}  $${parseFloat(i.total_price || 0).toFixed(2)}`).join('\n');

  const fmt = (n) => `$${parseFloat(n || 0).toFixed(2)}`;
  const taxPct = taxRate ? `${(parseFloat(taxRate) * 100).toFixed(2)}%` : '8.75%';

  await transporter.sendMail({
    from: `"BillTable" <${process.env.GMAIL_USER}>`,
    to: restaurantEmail,
    subject: `New Order #${orderNumber} — ${theme || 'BillTable'}`,
    text: `
New order received on BillTable!

Order #${orderNumber}
Theme: ${theme || '-'}
Guests: ${guestCount || '-'}
Delivery: ${deliveryTime || '-'}
Address: ${deliveryAddress || '-'}

Items:
${itemList}

─────────────────────────────
INVOICE SUMMARY
─────────────────────────────
Subtotal (food):       ${fmt(subtotal)}
Platform fee (10%):   -${fmt(platformFee)}
Delivery fee (5%):    -${fmt(deliveryFeeAmount)}
─────────────────────────────
Your payout:           ${fmt(restaurantPayout)}
─────────────────────────────
Tax collected (${taxPct}):  ${fmt(taxAmount)}
(BillTable remits tax to CDTFA — not deducted from your payout)
─────────────────────────────

Please log in to accept this order:
https://restaurant.billtable.co
    `.trim(),
  });
}

async function sendOrderConfirmationToCustomer({ customerEmail, customerName, orderNumber, restaurantName, theme, deliveryTime }) {
  await transporter.sendMail({
    from: `"BillTable" <${process.env.GMAIL_USER}>`,
    to: customerEmail,
    subject: `Your table is confirmed — Order #${orderNumber}`,
    text: `
Hi ${customerName || 'there'},

Your order has been confirmed!

Order #${orderNumber}
Restaurant: ${restaurantName || '-'}
Theme: ${theme || '-'}
Delivery: ${deliveryTime || '-'}

Track your order:
https://billtable.co

Table first. Food follows.
— BillTable
    `.trim(),
  });
}

async function sendPasswordResetEmail({ toEmail, toName, resetLink }) {
  await transporter.sendMail({
    from: `"BillTable" <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: `Reset your BillTable password`,
    text: `
Hi ${toName || 'there'},

We received a request to reset your BillTable password.

Click the link below to set a new password (expires in 1 hour):
${resetLink}

If you didn't request this, you can safely ignore this email.

Table first. Food follows.
— BillTable
    `.trim(),
  });
}

module.exports = { sendOrderNotificationToRestaurant, sendOrderConfirmationToCustomer, sendPasswordResetEmail };
