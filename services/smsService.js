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
    // Production Mode: call 5SIM API connecting to selected country and operator endpoint
    const apiKey = process.env.SMS_5SIM_API_KEY;
    try {
      // 5SIM Rent Activation API: GET /v1/user/buy/activation/{country}/{operator}/{service}
      const response = await axios.get(`https://5sim.net/v1/user/buy/activation/${country.toLowerCase()}/${operator.toLowerCase()}/${service}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json'
        }
      });

      if (!response.data || !response.data.id) {
        throw new Error(response.data ? response.data.error || 'Empty or invalid response from 5SIM' : 'Empty response from 5SIM');
      }

      return {
        id: String(response.data.id),
        phone_number: response.data.phone,
        expires_at: response.data.expires ? new Date(response.data.expires) : new Date(Date.now() + 15 * 60 * 1000)
      };
    } catch (error) {
      console.error('5SIM API error:', error.message);
      const errMsg = error.response && error.response.data
        ? (typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data))
        : error.message;
      throw new Error(errMsg);
    }
  }
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
      const capitalizedService = service.charAt(0).toUpperCase() + service.slice(1);
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
