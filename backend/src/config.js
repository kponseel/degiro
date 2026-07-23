import 'dotenv/config';

/** Configuration centralisée, lue depuis l'environnement. */
export const config = {
  port: Number(process.env.PORT) || 3000,
  logLevel: process.env.LOG_LEVEL || 'info',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'degiro_dev',
  },
  // Vérifié par le middleware d'auth (branché au M1).
  apiToken: process.env.API_TOKEN || '',
};
