# Pitch tours

Private 3D concept walkthroughs of a builder's own published plan, used in outreach.
Each tour lives at `/t/<plan>-<4 random chars>/`, is linked from nowhere on the site,
and is kept out of search by `robots.txt`, a noindex meta tag and an `X-Robots-Tag`
header (see `vercel.json`). Move a tour onto the public site only once that builder signs on.

## Files

- `_engine/plantour.js`: the 3D engine (walls, openings, floors, ceilings, kitchen, stair, furniture, finishes, lighting).
- `_engine/ui.js` and `_engine/tour.css`: title card, design packages, finish swatches, views.
- `_engine/shot.mjs`: renders stills for the email and the report.
- `<slug>/index.html`: copy from `greystone-qgjs/`, change only the plan path and the title.
- `<slug>/plan.json`: everything specific to one plan.

## Per-builder steps (manual)

1. Pick the plan on the builder's site and save the floor-plan image and the printed room sizes.
2. Make a slug: plan name plus 4 random characters (`openssl rand -hex 2`).
3. Copy `greystone-qgjs/` to the new slug and edit `plan.json`, in feet, x to the right and y toward the front:
   - `walls` with their openings (window, slider, door, front, opening), `floors`, `ceilings`, `soffits`.
   - `kitchen`: wall runs, range, fridge, island or peninsula, sink.
   - `fireplace` and `stair` if the plan has them, then `furniture`.
   - `views` (kitchen and great room at least) and `meta` (title, what is from the plan and what is estimated).
4. Check every view locally, then render stills with `shot.mjs` for each package.
5. Push to a branch, check the Vercel preview, and merge only when the link is going into an email.

Never use the builder's logo or brand marks, and never put numbers in a tour that the plan does not give.
