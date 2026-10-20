# Stripe Checkout Integration for meshlink Node Operators

This guide explains how to set up Stripe payments for your meshlink node using server-side Checkout Sessions. The broker creates checkout sessions dynamically, grants temporary internet access so the client can reach Stripe, and verifies payment server-side before granting full access.

## How It Works

```
Client selects a paid tier (e.g. Lightweight $4.99)
         |
         v
Frontend calls POST /api/payment/create-checkout
         |
         v
Broker grants temporary internet access (10 min)
Broker creates a Stripe Checkout Session via API
Returns { checkoutUrl } to the client
         |
         v
Client is redirected to Stripe's hosted checkout page
(temporary access lets them reach checkout.stripe.com)
         |
         v
Client completes payment on Stripe
Stripe redirects back to the captive portal with session_id
         |
         v
Frontend calls POST /api/complete-payment with stripeSessionId
         |
         v
Broker calls stripe.checkout.sessions.retrieve(sessionId)
Verifies payment_status === 'paid'
Grants full tier access (ipset add meshlink_auth)
Cancels temporary access timer
```

## Setup Steps

### 1. Create a Stripe Account
- Go to [https://stripe.com](https://stripe.com)
- Sign up for a free account
- Complete account verification (required for live payments)

### 2. Get Your Secret Key
1. Log in to your [Stripe Dashboard](https://dashboard.stripe.com)
2. Toggle **"Test mode"** on (top-right) for testing
3. Go to **Developers > API keys**
4. Copy your **Secret key** — it starts with `sk_test_...`

### 3. Configure the Broker

Create a `.env` file in the `broker/` directory:

```bash
echo "STRIPE_SECRET_KEY=sk_test_yourKeyHere" > broker/.env
```

The broker reads `STRIPE_SECRET_KEY` from the environment on each checkout request. On the Pi, the systemd service loads this file automatically via `EnvironmentFile`.

### 4. Configure Pricing Tiers

Edit `server/config/meshlink-config.json`. Each paid tier needs `acceptStripePayments: true` and a `fiatPrice` (in dollars):

```json
{
  "pricing": {
    "tiers": [
      {
        "id": "lightweight",
        "name": "Lightweight",
        "fiatPrice": 4.99,
        "acceptStripePayments": true,
        "isFree": false
      },
      {
        "id": "premium",
        "name": "Super Fast Premium",
        "fiatPrice": 9.99,
        "acceptStripePayments": true,
        "isFree": false
      }
    ]
  },
  "payments": {
    "stripe": {
      "enabled": true,
      "paymentMethods": ["card", "apple_pay", "google_pay", "link"],
      "currency": "usd"
    }
  }
}
```

No Payment Links or product IDs needed — the broker creates Stripe products/prices on the fly from the config.

## API Endpoints

### Create Checkout Session
```http
POST /api/payment/create-checkout
Content-Type: application/json

{
  "tierId": "lightweight"
}
```

**Response:**
```json
{
  "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_test_..."
}
```

Side effects:
- Grants 10-minute temporary internet access to the requesting client IP
- Creates a Stripe Checkout Session with the tier's name and price

### Complete Payment (with Stripe verification)
```http
POST /api/complete-payment
Content-Type: application/json

{
  "tierId": "lightweight",
  "userIdentifier": "device_abc123",
  "paymentMethod": "stripe",
  "paymentReference": "stripe_cs_test_...",
  "stripeSessionId": "cs_test_..."
}
```

The broker retrieves the Stripe session and verifies `payment_status === 'paid'` before granting access. For free tiers, no Stripe verification is needed.

## Testing

### Test Mode
1. Set `STRIPE_SECRET_KEY` to your `sk_test_...` key
2. Use Stripe's test card numbers:
   - **Success:** `4242 4242 4242 4242`
   - **Decline:** `4000 0000 0000 0002`
   - **3D Secure:** `4000 0025 0000 3155`
   - Any future expiry date, any 3-digit CVC
3. View test payments in [Stripe Dashboard > Payments](https://dashboard.stripe.com/test/payments)

### Live Mode
1. Complete Stripe account verification
2. Switch to your `sk_live_...` secret key in `.env`
3. Real payments will be processed

## Payment Method Configuration

Each pricing tier can accept different payment types:

```json
{
  "id": "premium",
  "acceptStripePayments": true,
  "acceptCryptoPayments": true
}
```

| Stripe | Crypto | Behavior |
|--------|--------|----------|
| `true` | `true` | Shows payment method selection screen |
| `true` | `false` | Goes straight to Stripe checkout |
| `false` | `true` | Crypto only |
| `false` | `false` | Free tier (no payment) |

## Temporary Access & Security

When a client initiates Stripe checkout:
1. The broker adds their IP to `meshlink_auth` ipset (grants internet)
2. A 10-minute timer starts to auto-revoke access
3. If the client completes payment and returns, the timer is cancelled and full tier access is granted
4. If the client abandons checkout, the timer fires and revokes internet access

This prevents:
- Clients exploiting the checkout flow for free internet (10 min max)
- Fake payment callbacks (server verifies with Stripe API)
- Payment Links requiring manual dashboard setup per tier

## Deployment on Raspberry Pi

The `install.sh` script in `meshlink-wifi-gateway/` creates the broker systemd service with:

```ini
EnvironmentFile=-/path/to/broker/.env
```

The `-` prefix means "don't fail if the file doesn't exist" (Stripe is optional). Just create the `.env` file and restart the broker:

```bash
echo "STRIPE_SECRET_KEY=sk_test_yourKeyHere" > /home/meshlink/meshlink/broker/.env
sudo systemctl restart meshlink-broker
```

## Why Not Webhooks?

The Pi is behind NAT with no public IP, so Stripe can't push webhook events to it. Instead, the broker verifies payment by calling `stripe.checkout.sessions.retrieve()` when the client returns from checkout. This is reliable for the captive portal use case since the client must return to get internet access.

## Troubleshooting

### "Stripe is not configured" error
- Check that `broker/.env` contains `STRIPE_SECRET_KEY=sk_test_...`
- Restart the broker: `sudo systemctl restart meshlink-broker`

### Client can't reach Stripe checkout
- Temporary access may not be working — check `sudo ipset list meshlink_auth`
- Check broker logs: `sudo journalctl -u meshlink-broker -n 30`

### Payment completes but access not granted
- Check that the redirect URL matches your broker's address
- Verify the Stripe session ID is being passed in the URL
- Check broker logs for verification errors

### Currency issues
- Set `payments.stripe.currency` in `meshlink-config.json`
- Stripe supports 135+ currencies
