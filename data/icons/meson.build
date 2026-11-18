application_id = 'io.github.ans_ibrahim.Memento'

scalable_dir = 'hicolor' / 'scalable' / 'apps'
scalable_icon = ('@0@.svg').format(application_id)
if get_option('profile') == 'development'
  scalable_icon = ('@0@.Devel.svg').format(application_id)
endif

install_data(
  scalable_dir / scalable_icon,
  rename: ('@0@.svg').format(application_id),
  install_dir: get_option('datadir') / 'icons' / scalable_dir,
)

symbolic_dir = 'hicolor' / 'symbolic' / 'apps'
install_data(
  symbolic_dir / ('@0@-symbolic.svg').format(application_id),
  install_dir: get_option('datadir') / 'icons' / symbolic_dir
)
