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
    from: `"TigTagTrue" <${process.env.GMAIL_USER}>`,
    to: restaurantEmail,
    subject: `New Order #${orderNumber} — ${theme || 'TigTagTrue'}`,
    text: `
New order received on TigTagTrue!

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
─────────────────────────────
Your payout:           ${fmt(restaurantPayout)}
─────────────────────────────
Tax collected (${taxPct}):  ${fmt(taxAmount)}
(TigTagTrue remits tax to CDTFA — not deducted from your payout)
─────────────────────────────

Please log in to accept this order:
https://restaurant.billtable.co
    `.trim(),
  });
}

async function sendOrderConfirmationToCustomer({ customerEmail, customerName, orderNumber, restaurantName, theme, deliveryTime }) {
  await transporter.sendMail({
    from: `"TigTagTrue" <${process.env.GMAIL_USER}>`,
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
— TigTagTrue
    `.trim(),
  });
}

async function sendPasswordResetEmail({ toEmail, toName, resetLink }) {
  await transporter.sendMail({
    from: `"TigTagTrue" <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: `Reset your TigTagTrue password`,
    html: `
      <div style="font-family:Georgia,'Times New Roman',serif;max-width:480px;margin:0 auto;padding:40px 24px;color:#1A1A1A;">
        <h2 style="font-size:28px;margin-bottom:4px;font-weight:bold;">TigTagTrue</h2>
        <p style="color:#4A4A4A;font-size:13px;margin-bottom:32px;">Reset your password</p>
        <p style="font-size:16px;">Hi ${toName || 'there'},</p>
        <p style="font-size:15px;color:#4A4A4A;">We received a request to reset your TigTagTrue password.</p>
        <div style="margin:32px 0;">
          <a href="${resetLink}" style="display:inline-block;background:#1A1A1A;color:#ffffff;padding:14px 32px;border-radius:12px;text-decoration:none;font-size:16px;font-weight:bold;">Reset my password →</a>
        </div>
        <p style="font-size:13px;color:#999;">Link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #E8E8E8;margin:32px 0;" />
        <p style="font-size:13px;color:#4A4A4A;font-style:italic;">Those who give their best often receive the best in return.</p>
        <p style="font-size:13px;color:#4A4A4A;">— TigTagTrue</p>
      </div>
    `,
  });
}

async function sendTrafficAlert({ concurrent, threshold, pct }) {
  await transporter.sendMail({
    from: `"TigTagTrue System" <${process.env.GMAIL_USER}>`,
    to: process.env.GMAIL_USER,
    subject: `TigTagTrue Traffic Alert — ${pct}% Capacity`,
    text: `
TigTagTrue Traffic Alert
─────────────────────────────
Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}

Matching Requests: ${concurrent} / ${threshold} concurrent
Capacity Used: ${pct}%

${pct >= 90 ? 'DANGER — System at capacity. Enable Limiter immediately.' : 'WARNING — High traffic detected. Monitor closely.'}

Open Admin Dashboard:
https://admin.billtable.co
─────────────────────────────
TigTagTrue Auto Alert System
    `.trim(),
  });
}

// A party-chat message was reported. Goes to the TigTagTrue inbox so it can
// be reviewed within 24h (Apple Guideline 1.2). The message is already
// hidden by the time this is sent.
async function sendChatReportAlert({ orderId, messageId, senderName, message, reason, reporterId }) {
  const esc = (v) => String(v ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  await transporter.sendMail({
    from: `"TigTagTrue System" <${process.env.GMAIL_USER}>`,
    to: process.env.GMAIL_USER,
    subject: `Chat report — order ${orderId}, message ${messageId}`,
    html: `<p><b>Reported message</b> (now hidden)</p>
      <p>Order: ${esc(orderId)}<br/>Message ID: ${esc(messageId)}<br/>From: ${esc(senderName)}<br/>Reported by user: ${esc(reporterId)}</p>
      <blockquote>${esc(message)}</blockquote>
      <p>Reason: ${esc(reason || '(none given)')}</p>`,
  });
}

async function sendPhotoReportAlert({ orderId, photoId, url, uploaderName, reporterId }) {
  const esc = (v) => String(v ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  await transporter.sendMail({
    from: `"TigTagTrue System" <${process.env.GMAIL_USER}>`,
    to: process.env.GMAIL_USER,
    subject: `Photo report — order ${orderId}, photo ${photoId}`,
    html: `<p><b>Reported party photo</b> (now hidden)</p>
      <p>Order: ${esc(orderId)}<br/>Photo ID: ${esc(photoId)}<br/>Added by: ${esc(uploaderName)}<br/>Reported by user: ${esc(reporterId)}</p>
      <p><a href="${esc(url)}">Open the photo</a></p>`,
  });
}

// Itemized receipt, sent when the restaurant marks the order delivered.
// Corporate and catering customers need one to expense the party.
async function sendReceiptToCustomer({ customerEmail, customerName, orderNumber, restaurantName, restaurantAddress, deliveryTime, items, subtotal, taxAmount, taxRate, total }) {
  const esc = (v) => String(v ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const money = (n) => `$${Number(n || 0).toFixed(2)}`;
  const rows = (items || []).map((i) => `<tr><td style="padding:4px 0">${esc(i.quantity)} × ${esc(i.item_name)}</td><td style="padding:4px 0;text-align:right">${money(i.total_price)}</td></tr>`).join('');
  await transporter.sendMail({
    from: `"TigTagTrue" <${process.env.GMAIL_USER}>`,
    to: customerEmail,
    subject: `Your TigTagTrue receipt — ${orderNumber}`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1A1A1A">
      <h2 style="margin:0 0 4px">TigTagTrue</h2>
      <p style="margin:0 0 16px;color:#4A4A4A">Receipt for ${esc(orderNumber)}</p>
      <p>Hi ${esc(customerName || 'there')}, thanks for your party. Here is your receipt.</p>
      <p style="margin:0">${esc(restaurantName)}<br/>${esc(restaurantAddress || '')}</p>
      <p style="margin:4px 0 16px;color:#4A4A4A">${esc(deliveryTime || '')}</p>
      <table style="width:100%;border-collapse:collapse;border-top:2px solid #1A1A1A">${rows}
        <tr><td style="padding:8px 0 2px;border-top:1px solid #E8E8E8">Subtotal</td><td style="text-align:right;border-top:1px solid #E8E8E8">${money(subtotal)}</td></tr>
        <tr><td style="padding:2px 0">Tax (${(Number(taxRate || 0) * 100).toFixed(2)}%)</td><td style="text-align:right">${money(taxAmount)}</td></tr>
        <tr><td style="padding:8px 0;font-weight:bold;border-top:2px solid #1A1A1A">Total</td><td style="text-align:right;font-weight:bold;border-top:2px solid #1A1A1A">${money(total)}</td></tr>
      </table>
      <p style="margin-top:24px;font-size:12px;color:#4A4A4A">BillBeBe Inc. · 45 S Arroyo Pkwy #1119, Pasadena, CA 91105 · billtable@billtable.co</p>
    </div>`,
  });
}

module.exports = { sendOrderNotificationToRestaurant, sendOrderConfirmationToCustomer, sendPasswordResetEmail, sendTrafficAlert, sendChatReportAlert, sendReceiptToCustomer, sendPhotoReportAlert };
