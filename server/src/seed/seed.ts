import { pool } from '../db.js';

/** Characters used by the sample data; never polled against the real API. */
export const SAMPLE_CHARACTERS = ['Blizzy', 'Hammerbro'];

/** Remove all sample drops, sample trades and sample stat history. */
export async function deleteSampleData() {
  await pool.query(`DELETE FROM listings WHERE id LIKE 'sample-%'`);
  await pool.query('DELETE FROM manual_sales WHERE sample');
  await pool.query(`DELETE FROM drops WHERE source = 'sample'`);
  await pool.query('DELETE FROM stat_samples WHERE character = ANY($1)', [SAMPLE_CHARACTERS]);
}
