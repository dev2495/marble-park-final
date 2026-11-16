# Marble Park website

A scroll-driven walk through the showroom. Stone surfaces are the ERP's own
catalogue slab photographs; the bath products (basins, mixers, WCs, flush
plates, rain heads, hand showers, ceiling panel) are real 3D models built to
the makers' catalogue dimensions and finishes, fitted where they would be
installed, with the water running.

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # static site in dist/
```

## Changing what is on show

- **Stone, doors, kitchen sinks:** edit `content/selection.json` (SKU, caption
  text and the catalogue image path from the ERP), then run
  `npm run sync:media` to download and prepare the photos into `public/media`.
- **Bath products:** the models are in `src/models.ts`; which products appear,
  with their sizes, finishes and captions, is the `PRODUCTS` table at the top
  of `src/world.ts`. Placement is in `buildRainBay`, `buildVanityBay` and
  `buildFormBay`.

In development, `?p=0.42` freezes the walk at that point of the scroll, which
is handy for checking one room.

## Going live at www.marblepark.in

The site is served by the same Caddy that fronts the ERP on the Lightsail
server. One-time setup:

1. **DNS (GoDaddy):** set the `@` A record for `marblepark.in` to
   `65.1.24.110` (remove the two GoDaddy forwarding A records). `www` is
   already a CNAME to the bare domain, so it follows.
2. **Server:** deploy the updated `deploy/aws/Caddyfile` and
   `deploy/aws/compose.yaml` (they add the `www.marblepark.in` site block and
   mount `${DATA_ROOT}/website` into Caddy), and recreate the Caddy container.
   Caddy fetches the HTTPS certificates itself once DNS points at the server.

After that, every release is:

```bash
website/scripts/deploy.sh
```

It builds, uploads, swaps the new build in, and keeps the previous one at
`/srv/marble-park/website.previous` for rollback. `marblepark.in` redirects to
`www.marblepark.in`; unknown paths redirect to the home page.
