import { expect, test } from '@playwright/test';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('用户名').fill('admin');
  await page.getByLabel('密码').fill('change-me-now');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).toHaveURL(/\/issues/);
  await expect(page.getByRole('heading', { name: 'Issues', exact: true })).toBeVisible();
}

test('desktop admin can reach the main and management surfaces', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await login(page);
  await page.getByRole('link', { name: '管理后台' }).click();
  await expect(page.getByRole('heading', { name: '平台概览' })).toBeVisible();
  await page.getByRole('link', { name: '用户', exact: true }).click();
  await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop-admin.png'), fullPage: true });
});

test('mobile navigation remains usable at 375px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');
  await login(page);
  await page.getByRole('button', { name: '打开导航' }).click();
  const mobileNavigation = page.getByRole('navigation', { name: '移动端主导航' });
  await expect(mobileNavigation).toBeVisible();
  await mobileNavigation.getByRole('link', { name: /通知/ }).click();
  await expect(page.getByRole('heading', { name: '通知', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-notifications.png'), fullPage: true });
});

test('Yunxiao integration page is usable without horizontal overflow', async ({ page }, testInfo) => {
  await login(page);
  await page.goto('/admin/yunxiao');
  await expect(page.getByRole('heading', { name: '云效联动', exact: true })).toBeVisible();
  await page.getByLabel('云效版本').selectOption('CENTRAL');
  await expect(page.getByLabel('组织 ID')).toBeVisible();
  await page.getByLabel('云效版本').selectOption('REGION');
  await expect(page.getByLabel('组织 ID')).toHaveCount(0);
  await expect(page.getByText('http://localhost:3101/api/integrations/yunxiao/webhook')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-yunxiao.png`), fullPage: true });
});

test('issue export and image attachments work end to end', async ({ page }, testInfo) => {
  await login(page);
  await page.getByRole('button', { name: '导出表格' }).click();
  await expect(page.getByRole('heading', { name: '选择导出时间段' })).toBeVisible();
  await expect(page.getByText('所有未关闭 Issue 都会导出')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '开始导出' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);

  await page.goto('/issues/1');
  await expect(page.getByRole('heading', { name: '附件', exact: true })).toBeVisible();
  const fileName = `e2e-${testInfo.project.name}.png`;
  await page.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  });
  await page.getByRole('button', { name: '上传 1 个附件' }).click();
  await expect(page.getByRole('button', { name: `预览 ${fileName}` })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: `删除 ${fileName}` }).click();
  await expect(page.getByRole('button', { name: `预览 ${fileName}` })).toHaveCount(0);
});
