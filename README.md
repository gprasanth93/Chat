# PGaaS Local Manager — Build Locally, Connect Like UAT & PROD

Local development should feel as seamless as deploying through **app.hsbc**.

With **PGaaS Local Manager**, developers can run applications and services locally while connecting to PGaaS through the same simple endpoint:

```text
localhost:5432
```

PGaaS Local takes care of the complexity behind the scenes — database discovery, credentials, routing, health, lifecycle and updates.

## One seamless app.hsbc developer journey

The goal is to make the database experience consistent from development all the way to production:

```text
app.hsbc
    ↓
Develop locally
    ↓
PGaaS Local Manager
    ↓
localhost:5432
    ↓
UAT
    ↓
PROD
```

You shouldn't need a completely different database setup just because you're working on your laptop.

**Build locally, test locally, then move to UAT and PROD with the same connectivity model.**

## Multiple services? Still one local port.

Developers often work on several services at the same time, and each service may need its own database.

For example:

```text
payment-service
    → db_payment_service_dev

customer-service
    → db_customer_service_dev

reporting-service
    → db_reporting_service_dev
```

All three services can run locally and still connect through:

```text
localhost:5432
```

Each service simply provides its required **database name and username**:

```text
payment-service
  host     = localhost
  port     = 5432
  database = db_payment_service_dev
  user     = payment_service

customer-service
  host     = localhost
  port     = 5432
  database = db_customer_service_dev
  user     = customer_service
```

PGaaS Local automatically routes each PostgreSQL connection to the correct database.

So instead of managing:

```text
payment    → localhost:5432
customer   → localhost:5433
reporting  → localhost:5434
```

you get:

```text
                    localhost:5432
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
      Payment DB      Customer DB     Reporting DB
```

**One Sidecar. One port. Multiple services. Multiple databases.**

## What PGaaS Local gives you

- **One local PostgreSQL endpoint** — `localhost:5432`
- **Multiple database connectivity** through the same port
- A **default database** for simple application connections
- Shared or personal development databases
- Automatic routing to the correct PGaaS/DHP database
- Credentials handled outside application code
- Built-in database health and status visibility
- Console and Doctor for troubleshooting
- Automatic Sidecar and Local Manager updates
- Safe upgrade and rollback
- A developer experience aligned with **app.hsbc, UAT and PROD**

## How do I use it?

Start **PGaaS Local Manager**, select or configure the databases required by your application, then point your local services to:

```text
host = localhost
port = 5432
```

For the default database, that's often all you need.

For additional databases, specify the required:

```text
database_name
username
```

and PGaaS Local handles the routing.

No need to find database endpoints manually.  
No need to maintain different local ports.  
No need to keep database passwords inside your application.

---

### From laptop to production, one experience

PGaaS Local Manager extends the **app.hsbc developer experience all the way to local development**.

> **Build locally. Run multiple services. Connect effortlessly. Move to UAT and PROD without changing the way your application connects to PostgreSQL.**
