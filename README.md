# Foodtrack — Expo demo deployment

Mobile-friendly food delivery prototype with Customer, Restaurant and Delivery Partner dashboards.

## Deploy a public link with Render
1. Extract this ZIP.
2. Create a GitHub repository and upload the **contents of the Foodtrack folder** so `package.json`, `server.js`, `render.yaml` and `public/` are at the repository root.
3. Sign in to https://render.com/ with GitHub.
4. Choose **New + → Blueprint**, select the repository, and apply the blueprint.
5. Wait for deployment, then open the `https://...onrender.com` URL.
6. Test on a phone using mobile data.

## Local run
Requires Node.js 18+: `npm install` then `npm start`; open http://localhost:3000.

## Expo demo flow
1. Create a Customer account; add a menu item to cart and place an order.
2. Create a Restaurant account in another browser/incognito session; accept the order, set Preparing, then Ready.
3. Create a Delivery Partner account in a third session; allow GPS, go online, accept the ready order, share GPS, then mark Picked up and Delivered.
4. Return to Customer to view order progress and demo QR verification.

## Prototype limitations
- Demo prototype, not a production food delivery service.
- QR/payment is simulated; no real payment is processed.
- Without `MONGODB_URI`, accounts/orders are in server memory and reset on restart/redeploy. Add MongoDB Atlas and set `MONGODB_URI` in Render for persistence.
- GPS requires browser permission and HTTPS. Render supplies HTTPS.
- Free hosting may sleep while idle and take time to wake.
- Use demo-only information, not real customer/payment data.
