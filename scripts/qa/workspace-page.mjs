// Playwright can set native inputs before React has attached their handlers.
// Match a customer's usable page by waiting for the workspace's readiness signal.
export function waitForWorkspaceNavigation(page) {
  for (const method of ['goto', 'reload']) {
    const navigate = page[method].bind(page);
    page[method] = async (...args) => {
      const response = await navigate(...args);
      const pathname = new URL(page.url()).pathname;
      if (pathname !== '/login' && pathname !== '/update-password' && !pathname.startsWith('/auth/'))
        await page.locator('[data-crm-ready="true"]').waitFor();
      return response;
    };
  }
}

export async function expandAdvancedFilters(page) {
  const button = page.getByRole('button', { name: 'Advanced filters', exact: true });
  await button.waitFor();
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
}

// Record filters use ordinary single-selection dropdowns.
export function recordFilterControl(page, label) {
  return page.getByLabel(label, { exact: true });
}
