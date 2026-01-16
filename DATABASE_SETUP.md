# Database Setup Guide

This guide explains how to set up the database for the Trade Bot application.

## Prerequisites

- PostgreSQL 12+ installed and running
- Node.js 20+ installed
- Access to create databases and users in PostgreSQL

## Quick Start

1. **Create Database and User**
   ```sql
   -- Connect to PostgreSQL as superuser
   psql -U postgres

   -- Create database and user
   CREATE DATABASE trade_bot;
   CREATE USER trade_bot_user WITH ENCRYPTED PASSWORD 'your_secure_password';
   GRANT ALL PRIVILEGES ON DATABASE trade_bot TO trade_bot_user;
   ```

2. **Configure Environment Variables**
   ```bash
   # Copy and edit .env file
   cp .env.example .env

   # Edit .env with your database credentials
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=trade_bot
   DB_USER=trade_bot_user
   DB_PASSWORD=your_secure_password
   ```

3. **Run Database Migrations**
   ```bash
   # Navigate to backend directory
   cd backend

   # Run migrations to create all tables
   npm run db:migrate:files
   ```

4. **Start the Application**
   ```bash
   # Start development server
   npm run dev
   ```

## Database Schema

The application uses the following main tables:

### Core Tables
- **`users`** - User accounts and authentication
- **`kodiak_credentials`** - Encrypted Kodiak API credentials
- **`strategies`** - Trading strategy definitions
- **`bot_instances`** - Running trading bots
- **`trades`** - Trade execution history

### Kodiak Integration Tables
- **`kodiak_accounts`** - Account information from Kodiak API
- **`kodiak_positions`** - Current trading positions
- **`kodiak_balances`** - Asset balances by currency
- **`kodiak_statistics`** - Trading volume and statistics

### System Tables
- **`audit_logs`** - Security and activity logging

## Migration Files

Migrations are stored in `database/migrations/` and run in alphabetical order:

1. **`001_base_schema.sql`** - Creates all core tables
2. **`002_initial_data.sql`** - Adds indexes, constraints, and views
3. **`003_safety_features.sql`** - Safety features and risk management

## Database Management Commands

```bash
# Run all migrations
npm run db:migrate:files

# Check migration status
npm run db:status

# Reset database (drop all tables and re-run migrations)
npm run db:reset

# Drop all tables
npm run db:drop
```

## Troubleshooting

### Connection Issues
- Ensure PostgreSQL is running: `sudo systemctl status postgresql`
- Check credentials in `.env` file
- Verify user has permissions on the database

### Migration Failures
- Check PostgreSQL logs for detailed error messages
- Ensure you have superuser privileges for extensions
- Verify all environment variables are set correctly

### Permission Errors
```sql
-- Grant necessary permissions
GRANT ALL PRIVILEGES ON DATABASE trade_bot TO trade_bot_user;
GRANT ALL ON SCHEMA public TO trade_bot_user;
```

## Production Setup

For production environments:

1. **Use strong passwords** and store them securely
2. **Enable SSL connections** to PostgreSQL
3. **Set up database backups** and monitoring
4. **Use connection pooling** for high traffic
5. **Enable PostgreSQL logging** for audit trails

### Environment Variables for Production
```bash
# Use environment-specific databases
DB_NAME=trade_bot_prod
DB_USER=trade_bot_prod_user

# Enable SSL
DB_SSL=true
DB_SSL_CA=/path/to/ca.pem

# Connection pooling
DB_POOL_MIN=2
DB_POOL_MAX=20
```

## Data Backup and Restore

### Backup
```bash
# Backup entire database
pg_dump -U trade_bot_user -h localhost trade_bot > backup.sql

# Backup specific tables
pg_dump -U trade_bot_user -h localhost -t users -t strategies trade_bot > users_strategies.sql
```

### Restore
```bash
# Restore from backup
psql -U trade_bot_user -h localhost trade_bot < backup.sql
```

## Performance Optimization

The migrations include optimized indexes for common queries:

- User email lookups
- Strategy and bot filtering
- Trade history queries
- Position and balance updates

For high-traffic applications, consider:
- Read replicas for analytics
- Partitioning large tables (trades, audit_logs)
- Archiving old data

## Support

If you encounter issues:

1. Check the application logs in `backend/logs/`
2. Verify database connectivity: `psql -U trade_bot_user -d trade_bot -c "SELECT 1"`
3. Review PostgreSQL logs: `tail -f /var/log/postgresql/postgresql-*.log`
4. Check the troubleshooting section above

The database is now ready for the trading platform! 🚀
