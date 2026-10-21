# Change your business logo

1. Sign in with your workspace **owner** account and open **Settings**.
2. In **Business logo**, choose **Choose image** (or **Change image**).
3. Select a PNG, JPG or WebP image up to 2 MB. A square logo works best.
4. Check the preview, then choose **Save logo**. **Cancel** leaves the saved logo
   as it was. Logo changes save separately from your other business preferences.

The saved image appears in desktop/mobile navigation, the sign-in/password pages,
and the browser tab. It stays after refreshing or restarting the app. Use
**Restore default** to return to the original ClearFlow icon. Uploading a logo
keeps the complete image, including transparency; it does not crop out the edges.
The original ClearFlow PNG is retained unchanged.

Members who are not owners can view branding but cannot change it. The server
enforces owner access for both upload and restore.

## Maintainer details

The authenticated owner-only `POST /api/crm/logo` accepts image bytes, validates
the actual format and dimensions, and re-encodes a still logo to WebP with a
maximum 256 × 256 bounding box. Metadata is removed; SVG/GIF and malformed or
oversized images are rejected. `DELETE /api/crm/logo` restores the default.
Neither operation changes Gmail, Sheets, customer records or automatic preferences.

The normalized image is saved as the optional `settings.businessLogo` field in
the existing private `.data/crm.json`, through the same serialized atomic storage
queue as other owner/automation writes. Existing backups therefore retain the
logo. Ordinary settings saves preserve it; the ordinary CRM mutation endpoint
cannot overwrite it from a supplied settings field. No new Supabase bucket,
credential or migration is needed.

Sign-in metadata receives only the public business name and logo. It does not
expose CRM records or unlock the CRM APIs. Private runtime files remain excluded
from every production route's file trace and must be supplied in private runtime
storage when deploying.

Validation includes raster format/dimension/metadata tests and the isolated
`scripts/check-business-logo.mjs` browser flow, which uses fake Supabase accounts
and a separate data directory. Screenshots are in `.local-preview/business-logo`.
