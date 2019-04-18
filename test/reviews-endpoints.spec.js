const knex = require('knex');
const app = require('../src/app');
const helpers = require('./test-helpers');
const supertest = require('supertest');

describe.only('Reviews Endpoints', function() {
  let db;

  const {
    testThings,
    testUsers,
    testReviews
  } = helpers.makeThingsFixtures();

  function makeAuthHeader(user) {
    const token = Buffer.from(`${user.user_name}:${user.password}`).toString('base64');
    return `Bearer ${token}`;
  }

  before('make knex instance', () => {
    db = knex({
      client: 'pg',
      connection: process.env.TEST_DB_URL,
    });
    app.set('db', db);
  });

  after('disconnect from db', () => db.destroy());

  before('cleanup', () => helpers.cleanTables(db));

  afterEach('cleanup', () => helpers.cleanTables(db));



  describe('POST /api/reviews', () => {
    beforeEach('insert things', () =>
      helpers.seedThingsTables(
        db,
        testUsers,
        testThings,
      )
    );
    it('creates an review, responding with 201 and the new review', function() {
      this.retries(3);
      const testThing = testThings[0];
      const testUser = testUsers[0];
      const newReview = {
        text: 'Test new review',
        rating: 3,
        thing_id: testThing.id,
        user_id: testUser.id,
      };
      return supertest(app)
        .post('/api/reviews')
        .set('Authorization',helpers.makeAuthHeader(testUsers[0]))
        .send(newReview)
        .expect(201)
        .expect(res => {
          expect(res.body).to.have.property('id');
          expect(res.body.rating).to.eql(newReview.rating);
          expect(res.body.text).to.eql(newReview.text);
          expect(res.body.thing_id).to.eql(newReview.thing_id);
          expect(res.body.user.id).to.eql(testUser.id);
          expect(res.headers.location).to.eql(`/api/reviews/${res.body.id}`);
          const expectedDate = new Date().toLocaleString();
          const actualDate = new Date(res.body.date_created).toLocaleString();
          expect(actualDate).to.eql(expectedDate);
        })
        .expect(res =>
          db
            .from('thingful_reviews')
            .select('*')
            .where({ id: res.body.id })
            .first()
            .then(row => {
              expect(row.text).to.eql(newReview.text);
              expect(row.rating).to.eql(newReview.rating);
              expect(row.thing_id).to.eql(newReview.thing_id);
              expect(row.user_id).to.eql(newReview.user_id);
              const expectedDate = new Date().toLocaleString();
              const actualDate = new Date(row.date_created).toLocaleString();
              expect(actualDate).to.eql(expectedDate);
            })
        );
    });

    const requiredFields = ['text', 'rating', 'user_id', 'thing_id'];

    requiredFields.forEach(field => {
      const testThing = testThings[0];
      const testUser = testUsers[0];
      const newReview = {
        text: 'Test new review',
        rating: 3,
        user_id: testUser.id,
        thing_id: testThing.id,
      };

      it(`responds with 400 and an error message when the '${field}' is missing`, () => {
        delete newReview[field];

        return supertest(app)
          .post('/api/reviews')
          .set('Authorization', helpers.makeAuthHeader(testUser))
          .send(newReview)
          .expect(400, {
            error: `Missing '${field}' in request body`,
          });
      });
    });
  });

  describe('Protected enpoints',()=>{
    beforeEach('insert things', () =>
      helpers.seedThingsTables(
        db,
        testUsers,
        testThings,
        testReviews,
      )
    );
    const protectedEndpoints = [
      {
        name: 'GET /api/things/:thing_id',
        path: '/api/things/1'
      },
      {
        name: 'GET /api/things/:thing_id/reviews',
        path: '/api/things/1/reviews'
      },
    ];
    protectedEndpoints.forEach(endpoint=>{
      describe(endpoint.path, () => {
        it('responds with 401 \'Missing bearer token\' when no bearer token', () => {
          return supertest(app)
            .get(endpoint.path)
            .expect(401, { error: 'Missing bearer token' });
        });
  
        it('responds 401 \'Unauthorized request\' when no credentials in token', () => {
          const userNoCreds = { user_name: '', password: '' };
          return supertest(app)
            .get(endpoint.path)
            .set('Authorization', makeAuthHeader(userNoCreds))
            .expect(401, { error: 'Unauthorized request' });
        });
  
        it('responds 401 \'Unauthorized request\' when invalid user', () => {
          const userInvalidCreds = { user_name: 'user-not', password: 'existy' };
          return supertest(app)
            .get(endpoint.path)
            .set('Authorization', makeAuthHeader(userInvalidCreds))
            .expect(401, { error: 'Unauthorized request' });
        });
  
        it('responds 401 \'Unauthorized request\' when invalid password', () => {
          const userInvalidPass = { user_name: testUsers[0].user_name, password: 'wrong' };
          return supertest(app)
            .get(endpoint.path)
            .set('Authorization', makeAuthHeader(userInvalidPass))
            .expect(401, { error: 'Unauthorized request' });
        });
      });
    });
  });  
  

  describe('GET /api/things', () => {
    context('Given no things', () => {
      it('responds with 200 and an empty list', () => {
        return supertest(app)
          .get('/api/things')
          .expect(200, []);
      });
    });
  
    context('Given there are things in the database', () => {
      beforeEach('insert things', () =>
        helpers.seedThingsTables(
          db,
          testUsers,
          testThings,
          testReviews,
        )
      );
  
      it('responds with 200 and all of the things', () => {
        const expectedThings = testThings.map(thing =>
          helpers.makeExpectedThing(
            testUsers,
            thing,
            testReviews,
          )
        );
        return supertest(app)
          .get('/api/things')
          .expect(200, expectedThings);
      });
    });
  
    context('Given an XSS attack thing', () => {
      const testUser = helpers.makeUsersArray()[1];
      const {
        maliciousThing,
        expectedThing,
      } = helpers.makeMaliciousThing(testUser);
  
      beforeEach('insert malicious thing', () => {
        return helpers.seedMaliciousThing(
          db,
          testUser,
          maliciousThing,
        );
      });
  
      it('removes XSS attack content', () => {
        return supertest(app)
          .get('/api/things')
          .expect(200)
          .expect(res => {
            // eslint-disable-next-line no-undef
            expect(res.body[0].title).to.eql(expectedThing.title);
            expect(res.body[0].content).to.eql(expectedThing.content);
          });
      });
    });
  });

  describe('GET /api/things/:thing_id', () => {
    context('Given no things', () => {
      beforeEach(() =>
        helpers.seedUsers(db, testUsers)
      );
      it('responds with 404', () => {
        const thingId = 123456;
        return supertest(app)
          .get(`/api/things/${thingId}`)
          .set('Authorization', helpers.makeAuthHeader(testUsers[0]))
          .expect(404, { error: 'Thing doesn\'t exist' });
      });
    });
  
    context('Given there are things in the database', () => {
      beforeEach('insert things', () =>
        helpers.seedThingsTables(
          db,
          testUsers,
          testThings,
          testReviews,
        )
      );
  
      it('responds with 200 and the specified thing', () => {
        const thingId = 2;
        const expectedThing = helpers.makeExpectedThing(
          testUsers,
          testThings[thingId - 1],
          testReviews,
        );
  
        return supertest(app)
          .get(`/api/things/${thingId}`)
          .set('Authorization', helpers.makeAuthHeader(testUsers[0]))
          .expect(200, expectedThing);
      });
    });
  
    context('Given an XSS attack thing', () => {
      const testUser = helpers.makeUsersArray()[1];
      const {
        maliciousThing,
        expectedThing,
      } = helpers.makeMaliciousThing(testUser);
  
      beforeEach('insert malicious thing', () => {
        return helpers.seedMaliciousThing(
          db,
          testUser,
          maliciousThing,
        );
      });
  
      it('removes XSS attack content', () => {
        return supertest(app)
          .get(`/api/things/${maliciousThing.id}`)
          .set('Authorization', helpers.makeAuthHeader(testUser))
          .expect(200)
          .expect(res => {
            expect(res.body.title).to.eql(expectedThing.title);
            expect(res.body.content).to.eql(expectedThing.content);
          });
      });
    });
  });
    
  describe('GET /api/things/:thing_id/reviews', () => {
    context('Given no things', () => {
      beforeEach(()=>
        helpers.seedUsers(db,testUsers)
      );
      it('responds with 404', () => {
        const thingId = 123456;
        return supertest(app)
          .get(`/api/things/${thingId}/reviews`)
          .set('Authorization', helpers.makeAuthHeader(testUsers[0]))
          .expect(404, { error: 'Thing doesn\'t exist' });
      });
    });
  
    context('Given there are comments for things in the database', () => {
      beforeEach('insert things', () =>
        helpers.seedThingsTables(
          db,
          testUsers,
          testThings,
          testReviews,
        )
      );
  
      it('responds with 200 and the specified reviews', () => {
        const thingId = 1;
        const expectedReviews = helpers.makeExpectedThingReviews(
          testUsers, thingId, testReviews
        );
  
        return supertest(app)
          .get(`/api/things/${thingId}/reviews`)
          .set('Authorization', helpers.makeAuthHeader(testUsers[0]))
          .expect(200, expectedReviews);
      });
    });
  });

    
});
