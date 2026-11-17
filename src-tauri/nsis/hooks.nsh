; Tauri NSIS 安装钩子。
;
; 模板里对 POSTINSTALL 的判断是 `!ifmacrodef NSIS_HOOK_POSTINSTALL`，所以宏必须叫这个名字，
; 叫 customInstall 只会被 include 进来、永远不会被插入（试过，无效）。
;
; 为什么需要它：Tauri 默认只在「静默安装」或用户在完成页勾选时才建桌面快捷方式，
; 而那个复选框默认不勾 —— 正常双击安装的人装完桌面是空的。
; CreateShortcut 对已存在的同名快捷方式是覆盖写，所以不会出现两个图标。
!macro NSIS_HOOK_POSTINSTALL
  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
!macroend