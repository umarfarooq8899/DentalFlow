'use strict';

const morgan = require('morgan');
const env = require('../config/env');

const requestLogger = morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev');

module.exports = { requestLogger };
