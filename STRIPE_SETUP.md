# Stripe Express Checkout Setup for MeshLink Node Operators

This guide explains how to set up Stripe payments for your MeshLink node using Stripe Payment Links - no API keys or server configuration required!

## What is Stripe Express Checkout?

Stripe Payment Links are pre-built checkout pages that you create in your Stripe Dashboard. They handle all payment processing, security, and compliance automatically. Your customers get redirected to a secure Stripe-hosted page to complete their payment.

## Setup Steps

### 1. Create a Stripe Account
- Go to [https://stripe.com](https://stripe.com)
- Sign up for a free account
- Complete account verification (required for live payments)

### 2. Create Payment Links
1. Login to your Stripe Dashboard
2. Go to **Products** → **Payment Links**
3. Click **Create Payment Link**
4. For each pricing tier in your config:
   - **Product Name**: Match your tier name (e.g. "Premium Speed")
   - **Price**: Set the fiat price (e.g. $2.99)
   - **Currency**: USD (or your local currency)
   - **Payment Methods**: Enable Card payments
   - **After Payment**: Set success URL to your redirect URL

### 3. Get Payment Link URLs
After creating each payment link, copy the full URL that looks like:
```
https://buy.stripe.com/live_xxxxxxxxxxxxxxxxxx
```

### 4. Update Your Node Configuration
Edit `server/config/meshlink-config.json`:

```json
{
  "pricing": {
    "tiers": [
      {
        "id": "premium",
        "name": "Premium Speed",
        "acceptStripePayments": true,
        "acceptCryptoPayments": true,
        "stripePaymentLink": "https://buy.stripe.com/live_xxxxxxxxxxxxxxxxxx"
      }
    ]
  },
  "stripe": {
    "enabled": true,
    "expressCheckout": true,
    "currency": "usd"
  }
}
```

## Testing

### Test Mode
- Use test payment links during development
- Test URLs start with `https://buy.stripe.com/test_`
- Use test card numbers from [Stripe's documentation](https://stripe.com/docs/testing#cards)

### Live Mode
- Switch to live payment links for production
- Live URLs start with `https://buy.stripe.com/live_`
- Real payments will be processed

## Payment Method Configuration

Each pricing tier can accept different payment types using boolean flags:

```json
{
  "id": "premium",
  "acceptStripePayments": true,    // Accept credit cards via Stripe
  "acceptCryptoPayments": true,    // Accept crypto payments
  "stripePaymentLink": "https://buy.stripe.com/live_xxx"
}
```

**Configuration Options:**
- `acceptStripePayments: true, acceptCryptoPayments: true` - Shows payment method selection
- `acceptStripePayments: true, acceptCryptoPayments: false` - Card payments only
- `acceptStripePayments: false, acceptCryptoPayments: true` - Crypto payments only
- `acceptStripePayments: false, acceptCryptoPayments: false` - Free tier only

## Benefits of This Approach

✅ **No API Keys**: No sensitive credentials to manage
✅ **No Server Setup**: No backend payment processing code
✅ **Automatic Security**: Stripe handles PCI compliance
✅ **Easy Updates**: Change prices in Stripe Dashboard
✅ **Mobile Optimized**: Works perfectly on all devices
✅ **Global Payments**: Supports international cards
✅ **Instant Setup**: Configure in minutes, not hours

## Troubleshooting

### Payment Link Not Working
- Verify the URL is correct and starts with `https://buy.stripe.com/`
- Ensure your Stripe account is activated
- Check that the payment link is not expired

### Payments Not Completing
- Verify your success URL is accessible
- Test with Stripe's test card numbers first
- Check Stripe Dashboard for payment status

### Currency Issues
- Ensure your payment link currency matches your config
- Stripe supports 135+ currencies

## Support

If you need help with Stripe setup:
1. Check [Stripe's Payment Links documentation](https://stripe.com/docs/payment-links)
2. Contact Stripe support through your dashboard
3. Join the MeshLink community for node operator support

## Security Notes

- Payment Links are public URLs - this is normal and secure
- Stripe handles all sensitive payment data
- Your node never sees credit card information
- All transactions are encrypted and monitored by Stripe