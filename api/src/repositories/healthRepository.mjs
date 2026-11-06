import { sequelize } from '../db/connection.mjs';

export function authenticateDatabase() {
  return sequelize.authenticate();
}
