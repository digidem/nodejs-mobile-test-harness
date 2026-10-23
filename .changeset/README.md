# Changesets

Add a changeset to any PR that changes published behaviour: `npx changeset`.
On merge to `main` a "chore: version packages" PR collects pending changesets;
merging that PR publishes to npm. See https://github.com/changesets/changesets.
