import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Browser journeys for the manager console.
 *
 * NOT EXECUTED on the build machine: the Playwright browsers were never downloaded
 * (roughly 400 MB). These specs are complete and the CI job runs them. That is recorded
 * in docs/test-results/README.md rather than implied otherwise.
 */

test.describe('manager console', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/console');
  });

  test('shows the demonstration notice without needing to scroll', async ({ page }) => {
    const notice = page.getByRole('note');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('not connected to any real farm');

    // In the header, not a footer. Somebody landing on an alert screen should not have
    // to scroll to find out that nobody is monitoring it.
    const box = await notice.boundingBox();
    expect(box?.y ?? Infinity).toBeLessThan(200);
  });

  test('starts with an empty state that does not read as a failure', async ({ page }) => {
    await expect(page.getByText('No active alerts')).toBeVisible();
    await expect(page.getByText(/Nothing needs refreshing/)).toBeVisible();
  });

  test('the skip link is the first thing a keyboard user reaches', async ({ page }) => {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  });

  test('the queue is a single tab stop', async ({ page }) => {
    await page.getByRole('button', { name: /demonstration alert/i }).click();
    await page.getByRole('button', { name: /demonstration alert/i }).click();
    await page.getByRole('button', { name: /demonstration alert/i }).click();

    const options = page.getByRole('option');
    await expect(options).toHaveCount(3);

    // One tab stop for the whole list. A manager working the keyboard while on a call
    // should not press Tab forty times to get past it.
    await expect(options.nth(0)).toHaveAttribute('tabindex', '0');
    await expect(options.nth(1)).toHaveAttribute('tabindex', '-1');
    await expect(options.nth(2)).toHaveAttribute('tabindex', '-1');
  });

  test('arrow keys move through the queue and Enter opens an alert', async ({ page }) => {
    await page.getByRole('button', { name: /demonstration alert/i }).click();
    await page.getByRole('button', { name: /demonstration alert/i }).click();

    const options = page.getByRole('option');
    await options.nth(0).focus();

    await page.keyboard.press('ArrowDown');
    await expect(options.nth(1)).toBeFocused();

    await page.keyboard.press('ArrowUp');
    await expect(options.nth(0)).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
  });

  test('End and Home jump to the ends of the queue', async ({ page }) => {
    for (let i = 0; i < 4; i += 1) {
      await page.getByRole('button', { name: /demonstration alert/i }).click();
    }

    const options = page.getByRole('option');
    await options.nth(0).focus();

    await page.keyboard.press('End');
    await expect(options.nth(3)).toBeFocused();

    await page.keyboard.press('Home');
    await expect(options.nth(0)).toBeFocused();
  });

  test('sorts critical above the rest', async ({ page }) => {
    for (let i = 0; i < 4; i += 1) {
      await page.getByRole('button', { name: /demonstration alert/i }).click();
    }

    // The list is what a manager's eye lands on first, so the ordering is doing real work.
    await expect(page.getByRole('option').first()).toContainText('Critical');
  });

  test('focus is visible rather than removed', async ({ page }) => {
    await page.getByRole('button', { name: /demonstration alert/i }).click();

    const option = page.getByRole('option').first();
    await option.focus();

    const outline = await option.evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('has no serious accessibility violations', async ({ page }) => {
    await page.getByRole('button', { name: /demonstration alert/i }).click();
    await page.getByRole('button', { name: /demonstration alert/i }).click();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const serious = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );

    expect(serious.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });

  test('does not scroll horizontally at a phone width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('button', { name: /demonstration alert/i }).click();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

test.describe('user portal', () => {
  test('states that precise location history is off by default', async ({ page }) => {
    await page.goto('/portal');

    const row = page.getByRole('row', { name: /Keep precise location history/ });
    await expect(row).toContainText('Off');
  });

  test('gives the settings table a caption for screen readers', async ({ page }) => {
    await page.goto('/portal');
    await expect(page.getByRole('table')).toHaveAccessibleName(/Default privacy settings/);
  });

  test('has no serious accessibility violations', async ({ page }) => {
    await page.goto('/portal');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const serious = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(serious.map((violation) => violation.id)).toEqual([]);
  });
});

test.describe('every page', () => {
  for (const path of ['/', '/portal', '/console']) {
    test(`${path} carries the demonstration notice`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('note')).toContainText('portfolio demonstration');
    });

    test(`${path} has exactly one level-one heading`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    });
  }
});
