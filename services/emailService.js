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
    html: `
      <div style="font-family:'Brush Script MT','Segoe Script','Comic Sans MS',cursive;max-width:480px;margin:0 auto;padding:40px 24px;color:#1A1A1A;">
        <h2 style="font-size:36px;margin-bottom:4px;font-weight:normal;">BillTable</h2>
        <p style="color:#4A4A4A;font-size:14px;margin-bottom:32px;">Reset your password</p>
        <p style="font-size:18px;">Hi ${toName || 'there'},</p>
        <p style="font-size:15px;color:#4A4A4A;">We received a request to reset your BillTable password.</p>
        <div style="margin:32px 0;">
          <a href="${resetLink}" style="display:inline-block;background:#1A1A1A;color:#ffffff;padding:14px 32px;border-radius:12px;text-decoration:none;font-size:16px;font-weight:bold;">Reset my password →</a>
        </div>
        <p style="font-size:13px;color:#999;">Link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #E8E8E8;margin:32px 0;" />
        <p style="font-size:13px;color:#4A4A4A;font-style:italic;">Those who give their best often receive the best in return.</p>
        <p style="font-size:13px;color:#4A4A4A;">— BillTable</p>
      </div>
    `,
  });
}

module.exports = { sendOrderNotificationToRestaurant, sendOrderConfirmationToCustomer, sendPasswordResetEmail };
