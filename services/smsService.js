const axios = require('axios');

/**
 * Rent a temporary virtual SMS number
 * @param {string} service - Platform name (e.g., 'telegram', 'whatsapp', 'google', 'chatgpt')
 * @returns {Promise<object>} Rented number details
 */
async function rentNumber(service, country = 'usa', operator = 'any') {
  const isSimulation = process.env.SIMULATION_MODE === 'true';

  if (isSimulation) {
    // Generate simulated virtual phone number mapped to target country codes
    const countryCodes = {
      usa: '+1',
      canada: '+1',
      england: '+44',
      germany: '+49',
      nigeria: '+234'
    };
    const selectedCC = countryCodes[country.toLowerCase()] || '+1';
    const randomDigits = Math.floor(1000000000 + Math.random() * 9000000000);
    const phoneNumber = `${selectedCC}${randomDigits}`;
    const id = `sim_act_${Math.floor(Math.random() * 1000000)}`;

    return {
      id,
      phone_number: phoneNumber,
      expires_at: new Date(Date.now() + 15 * 60 * 1000) // 15 mins expiry
    };
  } else {
    // Production Mode: call upstream virtual number allocation
    const apiKey = process.env.SMS_5SIM_API_KEY;
    try {
      const cCode = encodeURIComponent(country.toLowerCase());
      const oCode = encodeURIComponent(operator.toLowerCase());
      const sCode = encodeURIComponent(service.toLowerCase());

      const response = await axios.get(`https://5sim.net/v1/user/buy/activation/${cCode}/${oCode}/${sCode}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json'
        },
        timeout: 15000
      });

      // Check if upstream returned a plain text response like 'no free phones'
      if (typeof response.data === 'string') {
        const lowerText = response.data.toLowerCase();
        if (lowerText.includes('no free') || lowerText.includes('nofree')) {
          throw new Error('No free numbers available for this operator. Please select another operator with available numbers.');
        }
        throw new Error(formatUpstreamError(null, response.data));
      }

      if (!response.data || !response.data.id) {
        throw new Error(formatUpstreamError(null, response.data));
      }

      return {
        id: String(response.data.id),
        phone_number: response.data.phone,
        expires_at: response.data.expires ? new Date(response.data.expires) : new Date(Date.now() + 15 * 60 * 1000)
      };
    } catch (error) {
      console.error('Virtual number allocation error:', error.message);
      const rawData = error.response ? error.response.data : null;
      throw new Error(formatUpstreamError(error, rawData));
    }
  }
}

/**
 * Format and sanitize upstream provider errors so vendor names and HTML are never leaked
 */
function formatUpstreamError(error, rawData) {
  const dataStr = typeof rawData === 'string' ? rawData : (rawData ? JSON.stringify(rawData) : '');
  const lower = dataStr.toLowerCase();

  if (lower.includes('no free') || lower.includes('no_free') || lower.includes('nofree')) {
    return 'No free numbers available for this operator. Please select another operator with available numbers.';
  }
  // Sanitize HTML responses (like Next.js 404 error pages) first before checking words
  if (dataStr.includes('<html') || dataStr.includes('<!DOCTYPE') || dataStr.includes('NEXT_HTTP_ERROR')) {
    return 'Selected operator is currently unavailable. Please choose another operator with active numbers.';
  }
  if (lower.includes('not enough') || lower.includes('balance') || lower.includes('low_balance')) {
    return 'Service allocation temporarily unavailable due to upstream replenishment. Please try again in a few moments.';
  }
  if (rawData && typeof rawData === 'object' && rawData.error) {
    return String(rawData.error).replace(/5sim/gi, 'SMS Provider');
  }
  if (error && error.message) {
    if (error.message.includes('No free numbers available')) {
      return error.message;
    }
    return String(error.message).replace(/5sim/gi, 'SMS Provider');
  }
  return 'Failed to allocate virtual number. Please select another operator.';
}

/**
 * Check activation status or poll for OTP
 * @param {string} id - Activation order ID
 * @param {number} creationTimeMs - Timestamp when activation was created
 * @param {string} service - Service platform
 * @returns {Promise<object>} SMS status and message details
 */
async function checkSMS(id, creationTimeMs, service) {
  const isSimulation = process.env.SIMULATION_MODE === 'true' || id.startsWith('sim_act_');

  if (isSimulation) {
    const elapsedSeconds = (Date.now() - creationTimeMs) / 1000;
    
    if (elapsedSeconds >= 15) {
      // Auto-arrive code after 15 seconds
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const sName = service || 'service';
      const capitalizedService = sName.charAt(0).toUpperCase() + sName.slice(1);
      return {
        status: 'received',
        otp_code: otpCode,
        sms_text: `Your ${capitalizedService} verification code is: ${otpCode}. Please do not share this code.`
      };
    }

    return {
      status: 'waiting',
      otp_code: null,
      sms_text: null
    };
  } else {
    // Production Mode: call 5SIM API check endpoint
    const apiKey = process.env.SMS_5SIM_API_KEY;
    try {
      const response = await axios.get(`https://5sim.net/v1/user/check/${id}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json'
        }
      });

      const data = response.data;
      if (data.status === 'RECEIVED' && data.sms && data.sms.length > 0) {
        const fullSms = data.sms[data.sms.length - 1];
        // Match standard 4-8 digits, or WhatsApp-style 3-3 digits split by hyphen/space (e.g. 427-113)
        const match33 = fullSms.text.match(/\b\d{3}[-\s]\d{3}\b/);
        const matchNormal = fullSms.text.match(/\b\d{4,8}\b/);
        
        let otpCode = '';
        if (match33) {
          otpCode = match33[0].replace(/[-\s]/g, '');
        } else if (matchNormal) {
          otpCode = matchNormal[0];
        }
        return {
          status: 'received',
          otp_code: otpCode,
          sms_text: fullSms.text
        };
      } else if (data.status === 'TIMEOUT' || data.status === 'FINISHED') {
        return {
          status: data.status === 'FINISHED' ? 'received' : 'expired',
          otp_code: null,
          sms_text: null
        };
      }

      return {
        status: 'waiting',
        otp_code: null,
        sms_text: null
      };
    } catch (error) {
      console.error('5SIM API Check error:', error.message);
      return {
        status: 'waiting',
        otp_code: null,
        sms_text: null
      };
    }
  }
}

/**
 * Cancel virtual SMS activation
 * @param {string} id - Activation order ID
 * @returns {Promise<boolean>} Success status
 */
async function cancelNumber(id) {
  const isSimulation = process.env.SIMULATION_MODE === 'true' || id.startsWith('sim_act_');

  if (isSimulation) {
    return true;
  } else {
    const apiKey = process.env.SMS_5SIM_API_KEY;
    try {
      await axios.get(`https://5sim.net/v1/user/cancel/${id}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json'
        }
      });
      return true;
    } catch (error) {
      console.error('5SIM API Cancel error:', error.message);
      return false;
    }
  }
}

module.exports = {
  rentNumber,
  checkSMS,
  cancelNumber
};
