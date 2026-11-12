const button = document.querySelector('#open-login');
const status = document.querySelector('#status');

button.addEventListener('click', async () => {
  button.disabled = true;
  status.textContent = '正在開啟富途官方登入…';
  try {
    await chrome.windows.create({
      url: 'https://passport.futunn.com/',
      type: 'popup',
      width: 1180,
      height: 820,
      focused: true,
    });
    status.textContent = '登入視窗已開啟。';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    button.disabled = false;
  }
});
