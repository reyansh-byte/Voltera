const express = require('express');
const IrradianceService = require('../services/irradianceService');

class SolarController {
    /**
     * Get solar irradiance data for a specific location in India
     */
    static async getSolarData(req, res) {
        try {
            const { latitude, longitude } = req.query;
            
            if (!latitude || !longitude) {
                return res.status(400).json({ 
                    message: 'Latitude and longitude are required',
                    example: '/api/solar/data?latitude=28.6139&longitude=77.2090'
                });
            }

            const solarData = await IrradianceService.fetchSolarData(
                parseFloat(latitude), 
                parseFloat(longitude)
            );
            
            res.status(200).json(solarData);
        } catch (error) {
            res.status(500).json({ 
                message: 'Error fetching solar data', 
                error: error.message 
            });
        }
    }

    /**
     * Calculate solar potential for rooftop installation (Indian context)
     */
    static async calculateSolarPotential(req, res) {
        try {
            const { 
                area, 
                latitude, 
                longitude, 
                panelEfficiency = 0.18,  // 18% default (modern panels)
                systemEfficiency = 0.80, // 80% default (accounts for losses)
                electricityRate = 7.5    // ₹7.5 per kWh default
            } = req.body;

            if (!area || !latitude || !longitude) {
                return res.status(400).json({ 
                    message: 'Area, latitude, and longitude are required',
                    example: {
                        area: 100,
                        latitude: 28.6139,
                        longitude: 77.2090,
                        panelEfficiency: 0.18,
                        systemEfficiency: 0.80,
                        electricityRate: 7.5
                    }
                });
            }

            // Get irradiance data for the location
            const irradianceData = await IrradianceService.getIrradianceData(
                parseFloat(latitude), 
                parseFloat(longitude)
            );

            const irradiance = irradianceData.irradiance;

            // Calculate energy generation
            const energyCalc = IrradianceService.calculatePotentialEnergy(
                irradiance,
                parseFloat(area),
                parseFloat(panelEfficiency),
                parseFloat(systemEfficiency)
            );

            // Calculate system size (10 m² per kW for modern panels)
            const systemSizeKW = parseFloat(area) / 10;

            // Calculate costs (Indian market rates)
            const costPerKW = 60000; // ₹60,000 per kW
            const totalCost = systemSizeKW * costPerKW;

            // Calculate government subsidy (PM Surya Ghar scheme)
            let subsidy = 0;
            if (systemSizeKW <= 3) {
                subsidy = systemSizeKW * 18000;
            } else if (systemSizeKW <= 10) {
                subsidy = (3 * 18000) + ((systemSizeKW - 3) * 9000);
            } else {
                subsidy = (3 * 18000) + (7 * 9000); // Max subsidy for 10 kW
            }

            const netCost = totalCost - subsidy;

            // Calculate financial returns
            const annualEnergyKWh = parseFloat(energyCalc.annualEnergy);
            const annualSavings = annualEnergyKWh * parseFloat(electricityRate);
            const paybackPeriod = netCost / annualSavings;

            // Calculate carbon offset (0.82 kg CO2 per kWh for Indian grid)
            const annualCarbonOffsetKg = annualEnergyKWh * 0.82;

            const response = {
                location: {
                    latitude: parseFloat(latitude),
                    longitude: parseFloat(longitude),
                    region: irradianceData.dataSource
                },
                solarPotential: {
                    roofArea: parseFloat(area),
                    irradiance: irradiance,
                    systemSize: systemSizeKW.toFixed(2) + ' kW',
                    dailyGeneration: energyCalc.dailyEnergy + ' kWh',
                    monthlyGeneration: energyCalc.monthlyEnergy + ' kWh',
                    annualGeneration: energyCalc.annualEnergy + ' kWh'
                },
                financial: {
                    totalCost: '₹' + totalCost.toLocaleString('en-IN'),
                    governmentSubsidy: '₹' + subsidy.toLocaleString('en-IN'),
                    netCost: '₹' + netCost.toLocaleString('en-IN'),
                    annualSavings: '₹' + annualSavings.toLocaleString('en-IN', {maximumFractionDigits: 0}),
                    paybackPeriod: paybackPeriod.toFixed(1) + ' years',
                    lifetimeSavings: '₹' + (annualSavings * 25).toLocaleString('en-IN', {maximumFractionDigits: 0}),
                    currency: 'INR'
                },
                environmental: {
                    annualCO2Offset: annualCarbonOffsetKg.toFixed(0) + ' kg',
                    equivalentTrees: Math.round(annualCarbonOffsetKg / 20) + ' trees planted',
                    note: 'Based on Indian grid carbon intensity of 0.82 kg CO2/kWh'
                },
                assumptions: {
                    panelEfficiency: (parseFloat(panelEfficiency) * 100).toFixed(0) + '%',
                    systemEfficiency: (parseFloat(systemEfficiency) * 100).toFixed(0) + '%',
                    costPerKW: '₹' + costPerKW.toLocaleString('en-IN'),
                    electricityRate: '₹' + parseFloat(electricityRate) + '/kWh',
                    panelLifetime: '25 years',
                    subsidyScheme: 'PM Surya Ghar Muft Bijli Yojana'
                }
            };

            res.status(200).json(response);
        } catch (error) {
            res.status(500).json({ 
                message: 'Error calculating solar potential', 
                error: error.message 
            });
        }
    }

    /**
     * Assess rooftop for solar installation (simplified version)
     */
    static async assessRooftop(req, res) {
        return SolarController.calculateSolarPotential(req, res);
    }

    /**
     * Get irradiance data (alias for getSolarData)
     */
    static async getIrradianceData(req, res) {
        return SolarController.getSolarData(req, res);
    }

    /**
     * Get state-wise solar potential in India
     */
    static async getStatePotential(req, res) {
        try {
            const { state } = req.query;
            
            if (!state) {
                return res.status(400).json({ 
                    message: 'State name is required',
                    example: '/api/solar/state?state=Maharashtra'
                });
            }

            const statePotential = IrradianceService.getStateSolarPotential(state);
            
            res.status(200).json({
                state: state,
                ...statePotential,
                subsidyInfo: {
                    central: 'PM Surya Ghar scheme: ₹18,000/kW for first 3kW, ₹9,000/kW for 3-10kW',
                    note: 'Check with state DISCOM for additional state-level subsidies'
                }
            });
        } catch (error) {
            res.status(500).json({ 
                message: 'Error fetching state potential', 
                error: error.message 
            });
        }
    }

    /**
     * Calculate net metering benefits (Indian context)
     */
    static async calculateNetMetering(req, res) {
        try {
            const { 
                systemSizeKW, 
                annualConsumptionKWh,
                electricityRate = 7.5 
            } = req.body;

            if (!systemSizeKW || !annualConsumptionKWh) {
                return res.status(400).json({ 
                    message: 'System size and annual consumption are required',
                    example: {
                        systemSizeKW: 5,
                        annualConsumptionKWh: 6000,
                        electricityRate: 7.5
                    }
                });
            }

            // Estimate annual generation (assuming 5.5 kWh/kW/day average for India)
            const annualGeneration = parseFloat(systemSizeKW) * 5.5 * 365;

            const consumption = parseFloat(annualConsumptionKWh);
            const generation = annualGeneration;

            let netMeteringBenefit;
            if (generation >= consumption) {
                // Excess generation - may get credits
                netMeteringBenefit = {
                    selfConsumption: consumption,
                    excessGeneration: generation - consumption,
                    savingsFromSelfUse: consumption * parseFloat(electricityRate),
                    excessValue: (generation - consumption) * parseFloat(electricityRate) * 0.5, // Typically 50% credit
                    totalBenefit: (consumption * parseFloat(electricityRate)) + ((generation - consumption) * parseFloat(electricityRate) * 0.5),
                    note: 'Excess generation typically credited at 50-75% of retail rate. Check with your DISCOM.'
                };
            } else {
                // Partial generation - will still need grid power
                netMeteringBenefit = {
                    selfConsumption: generation,
                    remainingGridPurchase: consumption - generation,
                    savingsFromSelfUse: generation * parseFloat(electricityRate),
                    remainingBillCost: (consumption - generation) * parseFloat(electricityRate),
                    totalBenefit: generation * parseFloat(electricityRate),
                    note: 'System does not fully cover consumption. Consider increasing system size.'
                };
            }

            res.status(200).json({
                systemSize: parseFloat(systemSizeKW) + ' kW',
                estimatedAnnualGeneration: generation.toFixed(0) + ' kWh',
                annualConsumption: consumption + ' kWh',
                electricityRate: '₹' + parseFloat(electricityRate) + '/kWh',
                netMetering: {
                    ...netMeteringBenefit,
                    selfConsumption: netMeteringBenefit.selfConsumption.toFixed(0) + ' kWh',
                    savingsFromSelfUse: '₹' + netMeteringBenefit.savingsFromSelfUse.toLocaleString('en-IN', {maximumFractionDigits: 0}),
                    totalBenefit: '₹' + netMeteringBenefit.totalBenefit.toLocaleString('en-IN', {maximumFractionDigits: 0})
                },
                regulations: {
                    eligible: parseFloat(systemSizeKW) <= 100 ? 'Yes' : 'Check with DISCOM',
                    settlement: 'Annual or biannual settlement period',
                    metering: 'Bidirectional meter required'
                }
            });
        } catch (error) {
            res.status(500).json({ 
                message: 'Error calculating net metering', 
                error: error.message 
            });
        }
    }
}

module.exports = SolarController;