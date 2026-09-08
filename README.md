# Snap App Backend

Node.js + Express + **MongoDB (Mongoose)** API for Snap App (user + admin).

## Setup

```bash
cp .env.example .env
# set MONGO_URI in .env

npm install
npm run seed:force
npm run dev
```

API: `http://localhost:4000`

### Default accounts (after seed)

| Role  | Email              | Password   |
|-------|--------------------|------------|
| Admin | admin@snapapp.com  | Admin@123  |
| User  | alex@example.com   | User@123   |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start API with watch |
| `npm start` | Start API |
| `npm run seed` | Seed if empty |
| `npm run seed:force` | Clear + seed dummy data |

## Env

See `.env.example`. Required: `MONGO_URI`, `JWT_SECRET`.
