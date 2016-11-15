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

  const searchResults = $('.highlight');
  var searchIndex = 0;
  if (searchResults.length) {
    const animateToSearch = function() {
      const searchResult = $(searchResults.get(searchIndex));
      $('html, body').animate({
        scrollTop: searchResult.offset().top
      }, 1000);
    };
    animateToSearch();
    $('body').keypress(function(event) {
      if (event.which == 110 /* n key */) {
        event.preventDefault();
        searchIndex = (searchIndex + 1) % searchResults.length;
        animateToSearch();
      } else if (event.which == 112 /* p key */) {
        event.preventDefault();
        searchIndex = (searchIndex - 1) % searchResults.length;
        animateToSearch();
      }
    });
  }

});