const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

async function sendOrderNotificationToRestaurant({ restaurantEmail, restaurantName, orderNumber, theme, guestCount, deliveryTime, deliveryAddress, items }) {
  const itemList = (items || []).map(i => `• ${i.item_name} x${i.quantity}`).join('\n');

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

module.exports = { sendOrderNotificationToRestaurant, sendOrderConfirmationToCustomer };
