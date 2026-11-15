// WOW-025 C2 display: tooltip phrase per cap family. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conditionsCapLabel, conditionsCapFamily } from '../src/lib/wes-scale';

test('cap labels name the family that bound', () => {
  assert.equal(conditionsCapLabel('rain'), 'Capped for rain');
  assert.equal(conditionsCapLabel('rain likely'), 'Capped for rain');
  assert.equal(conditionsCapLabel('cold, heavy rain'), 'Capped for cold rain');
  assert.equal(conditionsCapLabel('breezy'), 'Capped for wind');
  assert.equal(conditionsCapLabel('high wind'), 'Capped for wind');
  assert.equal(conditionsCapLabel('chilly'), 'Capped for cold');
  assert.equal(conditionsCapLabel('dangerous cold'), 'Capped for cold');
  assert.equal(conditionsCapLabel('hot'), 'Capped for heat');
  assert.equal(conditionsCapLabel('extreme heat'), 'Capped for heat');
  assert.equal(conditionsCapLabel(null), '');
  assert.equal(conditionsCapFamily('very windy'), 'wind');
  assert.equal(conditionsCapFamily('bitter cold'), 'cold');
});
