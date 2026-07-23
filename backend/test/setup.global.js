// Setup global (une fois avant toute la suite) : applique les migrations sur la base de test.
export default async function setup() {
  process.env.DB_NAME = process.env.DB_NAME || 'degiro_test';
  process.env.API_TOKEN = process.env.API_TOKEN || 'test_token_0123456789';

  const { migrate } = await import('../src/db/migrate.js');
  await migrate();
}
