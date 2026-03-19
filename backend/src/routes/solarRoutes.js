const express = require('express');
const router = express.Router();
const SolarController = require('../controllers/solarController');

/**
 * Solar Assessment Routes for Indian Context
 * All financial calculations in Indian Rupees (₹)
 * Based on Indian solar regulations and subsidy schemes
 */

// Route to assess rooftop solar potential
router.post('/assess', SolarController.assessRooftop);

// Route to calculate detailed solar potential with financial analysis
router.post('/calculate', SolarController.calculateSolarPotential);

// Route to get solar irradiance data for a location
router.get('/irradiance', SolarController.getIrradianceData);

// Route to get general solar data for a location
router.get('/data', SolarController.getSolarData);

// Route to get state-wise solar potential in India
router.get('/state', SolarController.getStatePotential);

// Route to calculate net metering benefits
router.post('/net-metering', SolarController.calculateNetMetering);
/**
 * Example API calls:
 * 
 * 1. Get irradiance data:
 *    GET /api/solar/irradiance?latitude=28.6139&longitude=77.2090
 * 
 * 2. Calculate solar potential:
 *    POST /api/solar/calculate
 *    Body: {
 *      "area": 100,
 *      "latitude": 28.6139,
 *      "longitude": 77.2090,
 *      "panelEfficiency": 0.18,
 *      "systemEfficiency": 0.80,
 *      "electricityRate": 7.5
 *    }
 * 
 * 3. Get state potential:
 *    GET /api/solar/state?state=Maharashtra
 * 
 * 4. Calculate net metering:
 *    POST /api/solar/net-metering
 *    Body: {
 *      "systemSizeKW": 5,
 *      "annualConsumptionKWh": 6000,
 *      "electricityRate": 7.5
 *    }
 */

module.exports = router;