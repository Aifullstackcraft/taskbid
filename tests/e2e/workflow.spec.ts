import { test, expect } from '@playwright/test';
test('create, bid live across browsers, assign and complete a task', async ({ browser, page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Task board', exact: true })).toBeVisible();
  await page.screenshot({ path: 'tmp/screenshots/board-desktop.png', fullPage: true });
  await page.getByLabel('Current user').selectOption({ label: 'Ayesha Khan' });
  const title = `Browser workflow ${Date.now()}`;
  await page.getByRole('button', { name: 'Create task' }).click();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Description', { exact: true }).fill('End-to-end workflow fixture');
  await page.getByLabel('Deadline').fill('2030-10-10T12:00');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.screenshot({ path: 'tmp/screenshots/task-detail.png', fullPage: true });
  await page.getByRole('button', { name: 'Move to open' }).click();
  const other = await browser.newContext();
  const bidder = await other.newPage();
  await bidder.goto(page.url());
  await bidder.getByLabel('Current user').selectOption({ label: 'Maya Chen' });
  await bidder.getByLabel('Hours offered').fill('1.25');
  await bidder.getByRole('button', { name: 'Submit bid' }).click();
  await expect(bidder.getByText('Your bid is recorded.')).toBeVisible();
  await expect(page.locator('.bid-list')).toContainText('Maya Chen');
  await expect(page.locator('.bid-hours')).toContainText('1.25');
  await page.getByRole('button', { name: 'Move to bidding closed' }).click();
  await page.getByRole('button', { name: 'Assign lowest valid bidder' }).click();
  await expect(page.locator('.facts')).toContainText('Maya Chen');
  await expect(bidder.getByRole('button', { name: 'Move to in progress' })).toBeVisible();
  await bidder.getByRole('button', { name: 'Move to in progress' }).click();
  await bidder.getByRole('button', { name: 'Move to review' }).click();
  await page.getByRole('button', { name: 'Move to done' }).click();
  await expect(page.locator('.status-pill')).toHaveText('done');
  await other.close();
});
test('dashboard chart and mobile board are usable', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Average bid by complexity' })).toBeVisible();
  await expect(page.locator('.recharts-surface')).toBeVisible();
  await page.screenshot({ path: 'tmp/screenshots/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create task' })).toBeVisible();
  await expect(page.locator('.board')).toBeVisible();
  await page.screenshot({ path: 'tmp/screenshots/board-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('own task has no bid form and unknown page has a recovery link', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Current user').selectOption({ label: 'Ayesha Khan' });
  await page.getByRole('link').filter({ hasText: 'Build team activity feed' }).click();
  await expect(page.getByText('You created this task.')).toBeVisible();
  await expect(page.getByLabel('Hours offered')).toHaveCount(0);
  await page.goto('/missing-page');
  await expect(page.getByRole('link', { name: 'Return to the board' })).toBeVisible();
});
