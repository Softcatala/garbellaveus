module.exports = {
  default: {
    paths: ['features/**/*.feature'],
    require: ['features/support/**/*.js', 'features/steps/**/*.js'],
    format: ['progress-bar', 'summary'],
  },
};
