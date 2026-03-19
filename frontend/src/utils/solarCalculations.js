/**
 * Solar Energy Calculations for Indian Context
 * Based on Indian solar irradiance patterns and efficiency standards
 */

// Average solar irradiance in India varies by region:
// North India: 5.5-6.5 kWh/m²/day
// South India: 5.0-6.0 kWh/m²/day
// East India: 4.5-5.5 kWh/m²/day
// West India: 5.5-6.5 kWh/m²/day

export const calculateSolarEnergy = (area, irradiance, panelEfficiency = 0.18) => {
    // Modern panels in India typically have 18-20% efficiency
    // System efficiency accounts for inverter losses, cable losses, temperature effects
    const dailyEnergy = area * irradiance * panelEfficiency; // kWh/day
    const annualEnergy = dailyEnergy * 365; // kWh/year
    return {
        dailyEnergy,
        annualEnergy
    };
};

export const calculateUsableArea = (totalArea, obstacles) => {
    // Subtract obstacle area from total roof area
    return totalArea - obstacles; // m²
};

export const estimateSystemSize = (usableArea, panelEfficiency = 0.18) => {
    // In India, modern solar panels require approximately 10 m² per kW
    // This accounts for 18-20% efficient panels and spacing requirements
    const requiredAreaPerKW = 10; // m² per kW
    return usableArea / requiredAreaPerKW; // kW
};

export const calculateSystemCost = (systemSizeKW) => {
    // As of 2024-25, residential rooftop solar costs in India:
    // ₹50,000 - ₹70,000 per kW installed (including panels, inverter, mounting, installation)
    const costPerKW = 60000; // ₹60,000 per kW (average)
    return systemSizeKW * costPerKW; // Total cost in ₹
};

export const calculateGovernmentSubsidy = (systemSizeKW) => {
    /**
     * PM Surya Ghar Muft Bijli Yojana (2024)
     * Central Government Subsidy Structure:
     * - Up to 3 kW: ₹18,000 per kW
     * - Above 3 kW to 10 kW: ₹18,000 for first 3 kW + ₹9,000 per kW for remaining
     * - Maximum subsidy capped at 10 kW system
     */
    let subsidy = 0;
    
    if (systemSizeKW <= 3) {
        subsidy = systemSizeKW * 18000;
    } else if (systemSizeKW <= 10) {
        subsidy = (3 * 18000) + ((systemSizeKW - 3) * 9000);
    } else {
        // Maximum subsidy for 10 kW system
        subsidy = (3 * 18000) + (7 * 9000);
    }
    
    return subsidy; // Subsidy amount in ₹
};

export const calculateAnnualSavings = (annualEnergyKWh, electricityRatePerKWh = 7.5) => {
    /**
     * Average residential electricity rates in India (2024):
     * - Mumbai: ₹8-12/kWh
     * - Delhi: ₹5-8/kWh
     * - Bangalore: ₹6-9/kWh
     * - Chennai: ₹5-7/kWh
     * - Average: ₹7.5/kWh
     */
    return annualEnergyKWh * electricityRatePerKWh; // Annual savings in ₹
};

export const calculatePaybackPeriod = (netSystemCost, annualSavings) => {
    // Payback period in years (considering Net Metering benefits)
    if (annualSavings <= 0) return Infinity;
    return netSystemCost / annualSavings; // Years
};

export const calculateCarbonOffset = (annualEnergyKWh) => {
    /**
     * Carbon emission factor for Indian grid electricity
     * Average: 0.82 kg CO2 per kWh (as per CEA India)
     */
    const carbonFactorKgPerKWh = 0.82;
    const annualCarbonOffsetKg = annualEnergyKWh * carbonFactorKgPerKWh;
    const annualCarbonOffsetTonnes = annualCarbonOffsetKg / 1000;
    
    return {
        kg: annualCarbonOffsetKg,
        tonnes: annualCarbonOffsetTonnes
    };
};

export const getRegionalIrradiance = (state) => {
    /**
     * Average solar irradiance by Indian states (kWh/m²/day)
     * Source: MNRE (Ministry of New and Renewable Energy)
     */
    const irradianceMap = {
        // North India
        'Rajasthan': 6.5,
        'Gujarat': 6.2,
        'Punjab': 6.0,
        'Haryana': 6.0,
        'Delhi': 5.8,
        'Uttar Pradesh': 5.5,
        'Jammu and Kashmir': 5.5,
        'Himachal Pradesh': 5.5,
        'Uttarakhand': 5.5,
        
        // South India
        'Karnataka': 5.8,
        'Andhra Pradesh': 5.8,
        'Telangana': 5.8,
        'Tamil Nadu': 5.6,
        'Kerala': 5.2,
        'Puducherry': 5.6,
        
        // East India
        'West Bengal': 5.0,
        'Odisha': 5.2,
        'Bihar': 5.0,
        'Jharkhand': 5.0,
        'Chhattisgarh': 5.3,
        
        // West India
        'Maharashtra': 5.8,
        'Goa': 5.5,
        'Madhya Pradesh': 5.8,
        
        // Northeast India
        'Assam': 4.5,
        'Meghalaya': 4.5,
        'Tripura': 4.8,
        'Manipur': 4.8,
        'Mizoram': 4.8,
        'Nagaland': 4.5,
        'Arunachal Pradesh': 4.8,
        'Sikkim': 5.0,
    };
    
    return irradianceMap[state] || 5.5; // Default to 5.5 if state not found
};

export const checkNetMeteringEligibility = (systemSizeKW, connectionType = 'residential') => {
    /**
     * Net Metering regulations in India:
     * - Residential: Up to sanctioned load or 1 MW (whichever is lower)
     * - Commercial: Up to sanctioned load or 1 MW (whichever is lower)
     * - Most states allow net metering for systems up to 500 kW without special approval
     */
    if (connectionType === 'residential' && systemSizeKW <= 100) {
        return {
            eligible: true,
            message: 'Eligible for net metering under state regulations'
        };
    } else if (connectionType === 'commercial' && systemSizeKW <= 500) {
        return {
            eligible: true,
            message: 'Eligible for net metering. Check with local DISCOM for specific requirements'
        };
    } else {
        return {
            eligible: false,
            message: 'May require special approval from DISCOM'
        };
    }
};

export const estimateMaintenanceCost = (systemSizeKW) => {
    /**
     * Annual maintenance costs in India:
     * - Typical: 1-2% of system cost per year
     * - Includes cleaning, inverter maintenance, monitoring
     */
    const annualMaintenancePerKW = 1200; // ₹1,200 per kW per year
    return systemSizeKW * annualMaintenancePerKW; // Annual cost in ₹
};