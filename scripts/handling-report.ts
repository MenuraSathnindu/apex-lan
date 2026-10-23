// Prints handling numbers for the current tuning (shared/src/tuning.ts).
// Run: npm run handling
import { initRapier } from '../shared/src/physics/rapier.ts';
import { measureHandling } from '../shared/src/physics/handlingMetrics.ts';

await initRapier();
const r = measureHandling();
const row = (label: string, value: string, hint: string) => console.log(`  ${label.padEnd(26)} ${value.padStart(10)}   ${hint}`);
console.log('\nHandling report (shared/src/tuning.ts)\n');
row('Rest suspension sag', `${r.restSagCm.toFixed(1)} cm`, 'stiff: 1–4');
row('0–100 km/h', `${r.zeroTo100s.toFixed(2)} s`, 'open-wheel 2.3–3');
row('Top speed, wings closed', `${r.topSpeedKmh.toFixed(0)} km/h`, 'combustion engine only');
row('Top speed, wings open', `${r.topSpeedStraightKmh.toFixed(0)} km/h`, 'ERS adds ~40 km/h → ~330');
row('Lateral g at 250 km/h', `${r.fastCornerLateralG.toFixed(2)} g`, 'downforce: 4–6');
row('Braking 100–0', `${r.brake100to0m.toFixed(1)} m`, 'open-wheel 14–25');
row('Corner lateral grip', `${r.cornerLateralG.toFixed(2)} g`, 'low speed (little aero): 1.5–2.5');
row('Corner max body roll', `${r.cornerMaxRollDeg.toFixed(1)}°`, 'physics roll is ~0; visual roll in phase 6');
row('Corner stayed upright', r.cornerStayedUpright ? 'yes' : 'NO', '');
row('High-speed lock upright', r.highSpeedTurnUpright ? 'yes' : 'NO', '160 km/h full lock');
row('Peak slip, no handbrake', `${r.noHandbrakeSlipDeg.toFixed(1)}°`, 'grippy: < 8');
row('Peak slip, handbrake', `${r.handbrakeSlipDeg.toFixed(1)}°`, 'drifty: 20–60 (>90 = spin)');
row('Slip after recovery', `${r.handbrakeRecoverySlipDeg.toFixed(1)}°`, 'catchable: < 10');
row('Speed after drift', `${r.handbrakeEndSpeedKmh.toFixed(0)} km/h`, 'from 75; spin-out ≈ 0');
console.log('');
