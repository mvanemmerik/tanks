const http = require('http');

test('server returns 200 for GET /', (done) => {
  const req = http.get('http://localhost:3000/', (res) => {
    expect(res.statusCode).toBe(200);
    done();
  });
  req.on('error', done);
});
