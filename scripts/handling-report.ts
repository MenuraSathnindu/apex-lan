// Prints handling numbers for the current tuning (shared/src/tuning.ts).
// Run: npm run handling
import { initRapier } from '../shared/src/physics/rapier.ts';
import { measureHandling } from '../shared/src/physics/handlingMetrics.ts';

await initRapier();
const r = measureHandling();
const row = (label: string, value: string, hint: string) => console.log(`  ${label.padEnd(26)} ${value.padStart(10)}   ${hint}`);
console.log('\nHandling report (shared/src/tuning.ts)\n');
row('Rest suspension sag', `${r.restSagCm.toFixed(1)} cm`, 'typ. 5–10');
row('0–100 km/h', `${r.zeroTo100s.toFixed(2)} s`, 'sporty road car 5–7');
row('Top speed', `${r.topSpeedKmh.toFixed(0)} km/h`, '');
row('Braking 100–0', `${r.brake100to0m.toFixed(1)} m`, 'road car 35–40');
row('Corner lateral grip', `${r.cornerLateralG.toFixed(2)} g`, 'road tyres 0.9–1.1, arcade-sim 1.2–1.5');
row('Corner max body roll', `${r.cornerMaxRollDeg.toFixed(1)}°`, 'physics roll is ~0; visual roll in phase 6');
row('Corner stayed upright', r.cornerStayedUpright ? 'yes' : 'NO', '');
row('High-speed lock upright', r.highSpeedTurnUpright ? 'yes' : 'NO', '160 km/h full lock');
row('Peak slip, no handbrake', `${r.noHandbrakeSlipDeg.toFixed(1)}°`, 'grippy: < 8');
row('Peak slip, handbrake', `${r.handbrakeSlipDeg.toFixed(1)}°`, 'drifty: 20–60 (>90 = spin)');
row('Slip after recovery', `${r.handbrakeRecoverySlipDeg.toFixed(1)}°`, 'catchable: < 10');
row('Speed after drift', `${r.handbrakeEndSpeedKmh.toFixed(0)} km/h`, 'from 75; spin-out ≈ 0');
console.log('');
