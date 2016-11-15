$(function() {

  $(window).on('load resize', function() {
    $(window).trigger('scroll');
  });

  $('body').scrollspy({target: '#doc-nav', offset: 100});

  $('a.scrollto').on('click', function(e) {
    const target = this.hash;
    e.preventDefault();
    $('body').scrollTo(target, 800, {offset: 0, 'axis': 'y'});
  });

  $('table').addClass('table');
  $('#doc-menu > li > a').addClass('scrollto');

});