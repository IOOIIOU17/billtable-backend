const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// 1. Helmet - Security Headers
const helmetMiddleware = helmet();

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
