const axios = require('axios');

class IrradianceService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        // NASA POWER API is free and provides good coverage for India
        this.nasaPowerUrl = 'https://power.larc.nasa.gov/api/temporal/daily/point';
        // Alternative: NREL API for solar data
        this.nrelBaseUrl = 'https://developer.nrel.gov/api/solar';
    }

    /**
     * Get solar irradiance data for Indian locations
     * Uses NASA POWER API which provides reliable data for India
     */
    async getIrradianceData(latitude, longitude) {
        try {
            // NASA POWER API provides solar irradiance data
            const response = await axios.get(this.nasaPowerUrl, {
                params: {
                    parameters: 'ALLSKY_SFC_SW_DWN', // Global Horizontal Irradiance
                    community: 'RE',
                    longitude: longitude,
                    latitude: latitude,
                    start: '20230101',
                    end: '20231231',
                    format: 'JSON'
                }
            });

            // Calculate average daily irradiance from the data
            const data = response.data.properties.parameter.ALLSKY_SFC_SW_DWN;
            const values = Object.values(data);
            const avgIrradiance = values.reduce((sum, val) => sum + val, 0) / values.length;
            
            // Convert from W/m² to kWh/m²/day
            const dailyIrradianceKWh = (avgIrradiance * 24) / 1000;

            return {
                irradiance: dailyIrradianceKWh,
                unit: 'kWh/m²/day',
                latitude,
                longitude,
                dataSource: 'NASA POWER',
                averageType: 'Annual average for 2023'
            };
        } catch (error) {
            console.error('Error fetching NASA POWER data:', error.message);
            // Fallback to regional estimates for India
            return this.getFallbackIrradiance(latitude, longitude);
        }
    }

    /**
     * Fallback method using regional averages for India
     * Based on latitude ranges and known solar potential zones
     */
    getFallbackIrradiance(latitude, longitude) {
        let irradiance = 5.5; // Default average for India

        // Regional estimates based on latitude
        if (latitude >= 28 && latitude <= 35) {
            // North India (Rajasthan, Gujarat, Punjab, Delhi)
            irradiance = 6.0;
        } else if (latitude >= 23 && latitude < 28) {
            // Central India (Madhya Pradesh, Maharashtra)
            irradiance = 5.8;
        } else if (latitude >= 15 && latitude < 23) {
            // South India (Karnataka, Andhra Pradesh, Tamil Nadu)
            irradiance = 5.6;
        } else if (latitude >= 8 && latitude < 15) {
            // Deep South (Kerala, Tamil Nadu coastal)
            irradiance = 5.3;
        } else if (latitude >= 20 && latitude <= 26 && longitude >= 85 && longitude <= 98) {
            // East and Northeast India
            irradiance = 4.8;
        }

        // Adjust for specific high-potential zones
        if ((latitude >= 24 && latitude <= 30) && (longitude >= 68 && longitude <= 78)) {
            // Rajasthan and Gujarat - highest solar potential
            irradiance = 6.5;
        }

        return {
            irradiance,
            unit: 'kWh/m²/day',
            latitude,
            longitude,
            dataSource: 'Regional Estimate (India)',
            averageType: 'Regional annual average'
        };
    }

    /**
     * Calculate potential energy generation
     * @param {number} irradiance - Daily irradiance in kWh/m²/day
     * @param {number} area - Area in square meters
     * @param {number} efficiency - Panel efficiency (default 0.18 for 18%)
     * @param {number} systemEfficiency - Overall system efficiency (default 0.80 for 80%)
     */
    calculatePotentialEnergy(irradiance, area, efficiency = 0.18, systemEfficiency = 0.80) {
        const dailyEnergy = irradiance * area * efficiency * systemEfficiency; // kWh/day
        const annualEnergy = dailyEnergy * 365; // kWh/year
        
        return {
            dailyEnergy: dailyEnergy.toFixed(2),
            monthlyEnergy: (dailyEnergy * 30).toFixed(2),
            annualEnergy: annualEnergy.toFixed(0)
        };
    }

    /**
     * Get state-wise solar potential data for India
     */
    getStateSolarPotential(state) {
        const statePotential = {
            'Rajasthan': { irradiance: 6.5, potential: 'Excellent', rank: 1 },
            'Gujarat': { irradiance: 6.2, potential: 'Excellent', rank: 2 },
            'Andhra Pradesh': { irradiance: 5.8, potential: 'Very Good', rank: 3 },
            'Maharashtra': { irradiance: 5.8, potential: 'Very Good', rank: 4 },
            'Karnataka': { irradiance: 5.8, potential: 'Very Good', rank: 5 },
            'Punjab': { irradiance: 6.0, potential: 'Excellent', rank: 6 },
            'Haryana': { irradiance: 6.0, potential: 'Very Good', rank: 7 },
            'Tamil Nadu': { irradiance: 5.6, potential: 'Good', rank: 8 },
            'Madhya Pradesh': { irradiance: 5.8, potential: 'Very Good', rank: 9 },
            'Telangana': { irradiance: 5.8, potential: 'Very Good', rank: 10 },
            'Delhi': { irradiance: 5.8, potential: 'Very Good', rank: 11 },
            'Uttar Pradesh': { irradiance: 5.5, potential: 'Good', rank: 12 },
            'West Bengal': { irradiance: 5.0, potential: 'Moderate', rank: 13 },
            'Kerala': { irradiance: 5.2, potential: 'Good', rank: 14 },
            'Odisha': { irradiance: 5.2, potential: 'Good', rank: 15 }
        };

        return statePotential[state] || { irradiance: 5.5, potential: 'Good', rank: 'N/A' };
    }

    /**
     * Calculate financial returns based on Indian electricity rates
     * @param {number} annualEnergyKWh - Annual energy generation in kWh
     * @param {number} electricityRate - Rate in ₹/kWh (default 7.5)
     * @param {number} systemCost - Total system cost in ₹
     */
    calculateFinancialReturns(annualEnergyKWh, electricityRate = 7.5, systemCost) {
        const annualSavings = annualEnergyKWh * electricityRate;
        const paybackPeriod = systemCost / annualSavings;
        const lifetimeSavings = annualSavings * 25; // Assuming 25-year panel life
        const roi = ((lifetimeSavings - systemCost) / systemCost) * 100;

        return {
            annualSavings: `₹${annualSavings.toLocaleString('en-IN', {maximumFractionDigits: 0})}`,
            paybackPeriod: `${paybackPeriod.toFixed(1)} years`,
            lifetimeSavings: `₹${lifetimeSavings.toLocaleString('en-IN', {maximumFractionDigits: 0})}`,
            roi: `${roi.toFixed(1)}%`
        };
    }

    /**
     * Fetch solar data with comprehensive Indian context
     */
    async fetchSolarData(latitude, longitude) {
        try {
            const irradianceData = await this.getIrradianceData(latitude, longitude);
            
            return {
                ...irradianceData,
                timestamp: new Date().toISOString(),
                region: this.getIndianRegion(latitude, longitude),
                seasonalVariation: this.getSeasonalVariation(latitude)
            };
        } catch (error) {
            throw new Error('Error fetching solar data: ' + error.message);
        }
    }

    /**
     * Get Indian region based on coordinates
     */
    getIndianRegion(latitude, longitude) {
        if (latitude >= 28 && longitude >= 68 && longitude <= 78) return 'North India';
        if (latitude >= 15 && latitude < 23) return 'South India';
        if (latitude >= 20 && latitude <= 26 && longitude >= 85) return 'East India';
        if (latitude >= 18 && longitude >= 68 && longitude <= 78) return 'West India';
        if (latitude >= 24 && longitude >= 88) return 'Northeast India';
        return 'Central India';
    }

    /**
     * Seasonal variation in solar irradiance for India
     */
    getSeasonalVariation(latitude) {
        return {
            summer: 'Peak generation (March-June): 110-120% of average',
            monsoon: 'Reduced generation (July-September): 70-80% of average',
            winter: 'Good generation (October-February): 90-100% of average',
            note: 'Actual variation depends on local weather patterns and cloud cover'
        };
    }
}

module.exports = new IrradianceService(process.env.SOLAR_API_KEY || 'demo');