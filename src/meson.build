pkgdatadir = get_option('datadir') / meson.project_name()
gnome = import('gnome')

src_res = gnome.compile_resources('io.github.ans_ibrahim.Memento.src',
  'io.github.ans_ibrahim.Memento.src.gresource.xml',
  gresource_bundle: true,
  install: true,
  install_dir: pkgdatadir,
)

data_res = gnome.compile_resources('io.github.ans_ibrahim.Memento.data',
  'io.github.ans_ibrahim.Memento.data.gresource.xml',
  gresource_bundle: true,
  install: true,
  install_dir: pkgdatadir,
)

bin_conf = configuration_data()
bin_conf.set('GJS', find_program('gjs').full_path())
bin_conf.set('PACKAGE_VERSION', meson.project_version())
bin_conf.set('PACKAGE_NAME', meson.project_name())
bin_conf.set('prefix', get_option('prefix'))
bin_conf.set('libdir', get_option('prefix') / get_option('libdir'))
bin_conf.set('datadir', get_option('prefix') / get_option('datadir'))
bin_conf.set('resource_path', '/app/memento/memento')

configure_file(
  input: 'io.github.ans_ibrahim.Memento.in',
  output: 'io.github.ans_ibrahim.Memento',
  configuration: bin_conf,
  install: true,
  install_dir: get_option('bindir')
)
