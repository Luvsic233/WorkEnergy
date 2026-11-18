; Tauri NSIS 安装钩子。
;
; 1) 桌面快捷方式：Tauri 默认只在「静默安装」或用户勾选完成页那个复选框时创建，而复选框默认不勾，
;    正常双击安装的人装完桌面是空的。CreateShortcut 对同名快捷方式是覆盖写，不会出现两个图标。
;
; 2) 图标缓存：Windows 按「路径」缓存图标。同一个 work-energy.exe 在旧版本里是坏图标时，
;    升级后桌面上会继续显示那张旧图（实测：装完 0.5.0 桌面仍是半透明框，F5 也不一定好），
;    必须让 shell 丢掉缓存条目并广播一次变更。
!macro NSIS_HOOK_POSTINSTALL
  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  ; 让 shell 重建图标缓存（等价于 ie4uinit -show + 广播 SHCNE_ASSOCCHANGED）
  nsExec::Exec '$SYSDIR\ie4uinit.exe -show'
  System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0x1000, i 0, i 0)'
!macroend