// Reads back what each OpenRGB device is showing, as a second SDK client.
import sdk from 'openrgb-sdk';
const c = new sdk.Client('KelvinRGB check', 6742, '127.0.0.1');
await c.connect(3000);
for (const d of await c.getAllControllerData()) {
  const hex = d.colors.slice(0, 3).map((x) => '#' + [x.red, x.green, x.blue].map((v) => v.toString(16).padStart(2, '0')).join(''));
  console.log(`${d.name} | ${d.location} | mode ${d.modes[d.activeMode] && d.modes[d.activeMode].name} | ${d.colors.length} leds | ${hex.join(' ')}`);
}
c.disconnect();
