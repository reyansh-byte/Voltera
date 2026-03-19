import React, { useState, useEffect } from 'react';
import { calculateSolarEnergy } from '../utils/solarCalculations';

const Calculator = ({ usableArea, solarIrradiance }) => {
    const [panelEfficiency, setPanelEfficiency] = useState(18); // Modern panels in India
    const [systemEfficiency, setSystemEfficiency] = useState(80); // Accounting for losses
    const [electricityRate, setElectricityRate] = useState(7.5); // ₹/kWh (average for residential in India)
    const [annualOutput, setAnnualOutput] = useState(0);
    const [dailyOutput, setDailyOutput] = useState(0);
    const [systemSize, setSystemSize] = useState(0);
    const [paybackYears, setPaybackYears] = useState(0);
    const [totalCost, setTotalCost] = useState(0);
    const [subsidy, setSubsidy] = useState(0);
    const [netCost, setNetCost] = useState(0);
    const [annualSavings, setAnnualSavings] = useState(0);

    useEffect(() => {
        if (usableArea > 0 && solarIrradiance > 0) {
            const { dailyEnergy, annualEnergy } = calculateSolarEnergy(usableArea, solarIrradiance, panelEfficiency / 100);
            const adjustedAnnual = annualEnergy * (systemEfficiency / 100);
            setDailyOutput(dailyEnergy * (systemEfficiency / 100));
            setAnnualOutput(adjustedAnnual);
            
            // System size calculation (approx 10 m² per kW for modern panels)
            const calculatedSystemSize = usableArea / 10;
            setSystemSize(calculatedSystemSize);
            
            // Indian cost structure (₹50,000 - ₹70,000 per kW installed)
            const costPerKW = 60000; // ₹60,000 per kW (average)
            const systemCostTotal = calculatedSystemSize * costPerKW;
            setTotalCost(systemCostTotal);
            
            // Central Government Subsidy (as per PM Surya Ghar Scheme)
            // Up to 3 kW: ₹18,000 per kW
            // Above 3 kW to 10 kW: ₹18,000 for first 3 kW + ₹9,000 per kW for remaining
            let subsidyAmount = 0;
            if (calculatedSystemSize <= 3) {
                subsidyAmount = calculatedSystemSize * 18000;
            } else if (calculatedSystemSize <= 10) {
                subsidyAmount = (3 * 18000) + ((calculatedSystemSize - 3) * 9000);
            } else {
                // Max subsidy for 10 kW
                subsidyAmount = (3 * 18000) + (7 * 9000);
            }
            setSubsidy(subsidyAmount);
            
            const netSystemCost = systemCostTotal - subsidyAmount;
            setNetCost(netSystemCost);
            
            // Annual savings calculation
            const yearlyElectricitySavings = adjustedAnnual * electricityRate;
            setAnnualSavings(yearlyElectricitySavings);
            
            // Payback period
            const payback = netSystemCost / yearlyElectricitySavings;
            setPaybackYears(payback);
        }
    }, [usableArea, solarIrradiance, panelEfficiency, systemEfficiency, electricityRate]);

    return (
        <div className="calculator">
            <h2>Solar Output Calculator</h2>
            <div>
                <label>
                    Usable Area (m²):
                    <input type="number" value={usableArea.toFixed(2)} readOnly />
                </label>
            </div>
            <div>
                <label>
                    Solar Irradiance (kWh/m²/day):
                    <input type="number" value={solarIrradiance.toFixed(2)} readOnly />
                </label>
            </div>
            <div>
                <label>
                    Panel Efficiency (%):
                    <input
                        type="number"
                        value={panelEfficiency}
                        onChange={(e) => setPanelEfficiency(Number(e.target.value))}
                    />
                </label>
            </div>
            <div>
                <label>
                    System Efficiency (%):
                    <input
                        type="number"
                        value={systemEfficiency}
                        onChange={(e) => setSystemEfficiency(Number(e.target.value))}
                    />
                </label>
            </div>
            <div>
                <label>
                    Electricity Rate (₹/kWh):
                    <input
                        type="number"
                        step="0.5"
                        value={electricityRate}
                        onChange={(e) => setElectricityRate(Number(e.target.value))}
                    />
                </label>
            </div>
            
            <div className="calculator-results">
                <h3>Daily Output: {dailyOutput.toFixed(2)} kWh</h3>
                <h3>Annual Output: {annualOutput.toFixed(0)} kWh/year</h3>
                <h3>System Size: {systemSize.toFixed(2)} kW</h3>
                <h3>Total Cost: ₹{totalCost.toLocaleString('en-IN', {maximumFractionDigits: 0})}</h3>
                <h3>Government Subsidy: ₹{subsidy.toLocaleString('en-IN', {maximumFractionDigits: 0})}</h3>
                <h3>Net Cost: ₹{netCost.toLocaleString('en-IN', {maximumFractionDigits: 0})}</h3>
                <h3>Annual Savings: ₹{annualSavings.toLocaleString('en-IN', {maximumFractionDigits: 0})}/year</h3>
                <h3>Payback Period: {paybackYears.toFixed(1)} years</h3>
            </div>
            
            <p style={{ marginTop: '16px', marginBottom: '0', fontSize: '12px', lineHeight: '1.5' }}>
                <small>
                    Based on Indian solar regulations & PM Surya Ghar scheme. 
                    Subsidy: ₹18,000/kW for first 3kW, ₹9,000/kW for 3-10kW. 
                    Avg cost: ₹60,000/kW. ~10m² per kW capacity.
                </small>
            </p>
        </div>
    );
};

export default Calculator;