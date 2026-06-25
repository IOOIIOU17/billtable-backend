const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// 1. Helmet - Security Headers + CSP (ป้องกัน XSS / localStorage JWT exposure)
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://js.stripe.com", "https://fonts.googleapis.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
      connectSrc: ["'self'", "https://billtable-backend.onrender.com", "https://api.stripe.com"],
      frameSrc: ["'self'", "https://js.stripe.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
});

// 2. CORS - Cross-Origin
const corsMiddleware = cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://billtable-customer-web.onrender.com',
    'https://billtable-restaurant.onrender.com',
    'https://billtable-admin.onrender.com',
    'https://billtable.co',
    'https://www.billtable.co',
    'https://restaurant.billtable.co',
    'https://admin.billtable.co',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
});

// 3. Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: 'Too many requests, please try again later'
});

module.exports = {
  helmetMiddleware,
  corsMiddleware,
  limiter
};
