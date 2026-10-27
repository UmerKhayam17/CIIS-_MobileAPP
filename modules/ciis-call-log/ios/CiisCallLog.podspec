Pod::Spec.new do |s|
  s.name           = 'CiisCallLog'
  s.version        = '0.1.0'
  s.summary        = 'Reads permitted Android call history. iOS returns no cellular history.'
  s.description    = 'Local CIIS module'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
