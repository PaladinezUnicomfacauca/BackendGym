CREATE TABLE roles (
    id_role SERIAL PRIMARY KEY,
    name_role VARCHAR(20) UNIQUE NOT NULL
);

CREATE TABLE managers (
    id_manager SERIAL PRIMARY KEY,
    name_manager VARCHAR(40) NOT NULL,
    phone VARCHAR(10) UNIQUE NOT NULL,
    email VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(60) NOT NULL,
    id_role INTEGER NOT NULL REFERENCES roles(id_role)
        ON DELETE RESTRICT  
        ON UPDATE CASCADE
);

CREATE TABLE plans (
    id_plan SERIAL PRIMARY KEY,
    days_duration INT NOT NULL,
    price INT UNIQUE NOT NULL,
    plan_description VARCHAR(22) UNIQUE NOT NULL
);

CREATE TABLE payment_methods (
    id_method SERIAL PRIMARY KEY,
    name_method varchar(13) UNIQUE NOT NULL
);

CREATE TABLE states (
    id_state SERIAL PRIMARY KEY,
    name_state VARCHAR(10) UNIQUE NOT NULL
);

CREATE TABLE users (
    id_user SERIAL PRIMARY KEY,
    name_user VARCHAR(40) NOT NULL,
    phone VARCHAR(10) UNIQUE NOT NULL,
    created_at DATE DEFAULT CURRENT_DATE
);

CREATE TABLE memberships (
    id_membership SERIAL PRIMARY KEY,
    last_payment DATE DEFAULT CURRENT_DATE,
    expiration_date DATE NOT NULL,
    receipt_number VARCHAR(10) UNIQUE NOT NULL,
    days_arrears INT DEFAULT 0, 
    manager_name_snapshot VARCHAR(40),
    id_manager INTEGER NULL REFERENCES managers(id_manager)
        ON DELETE SET NULL  
        ON UPDATE CASCADE,
    id_user INTEGER NOT NULL REFERENCES users(id_user)
        ON DELETE RESTRICT 
        ON UPDATE CASCADE,
    id_plan INTEGER NOT NULL REFERENCES plans(id_plan)
        ON DELETE RESTRICT  
        ON UPDATE CASCADE,
    id_method INTEGER NOT NULL REFERENCES payment_methods(id_method)
        ON DELETE RESTRICT  
        ON UPDATE CASCADE,
    id_state INTEGER NOT NULL REFERENCES states(id_state)
        ON DELETE RESTRICT   
        ON UPDATE CASCADE 
);
